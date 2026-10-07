package api

// One-click apply for structured suggestions on anchored comments
// (P0-2). Empirically the highest-actionability review artifact in
// the doc-collaboration prior art (Brown & Parnin ESEC/FSE '20). A
// suggestion carries a replacement string; applying it creates a
// manual revision that swaps the comment's Anchor.Exact for the
// replacement, then resolves the comment. Doc-level comments (no
// anchor) can't carry suggestions — there's nothing to replace.

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"go.mongodb.org/mongo-driver/v2/bson"

	"markupmarkdown/internal/models"
)

// applySuggestion is POST /api/comments/:id/apply-suggestion. Reads
// the comment's Suggestion, replaces the anchored occurrence of
// Anchor.Exact in the doc content with Suggestion.Replacement, and
// creates a manual revision + resolves the comment. Idempotent-ish:
// once a suggestion is stamped applied (AppliedAt), a second call is
// a 409 (already applied) so double-clicks don't create duplicate
// revisions.
func (a *API) applySuggestion(w http.ResponseWriter, r *http.Request) {
	commentID := mux.Vars(r)["id"]
	comment, doc, accErr := a.checkCommentAccess(r, commentID)
	if accErr != nil {
		a.writeAccessError(w, r, accErr)
		return
	}
	user := a.currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "sign in required")
		return
	}
	// Applying a suggestion creates a new doc — same admin bar as
	// acceptRevision and createManualRevision.
	if !a.enforceScope(w, r, models.TokenScopeAdmin) {
		return
	}
	if comment.Suggestion == nil {
		writeError(w, http.StatusBadRequest, "this comment has no suggestion attached")
		return
	}
	if comment.Suggestion.AppliedAt != nil {
		writeError(w, http.StatusConflict, "this suggestion was already applied")
		return
	}
	if comment.Anchor.Exact == "" {
		writeError(w, http.StatusBadRequest, "doc-level comments can't carry suggestions — there's nothing to replace")
		return
	}

	// Substitution against the source, at the occurrence the anchor
	// actually designates (see resolveAnchorInSource) — never "the
	// first one that happens to match".
	original := comment.Anchor.Exact
	replacement := comment.Suggestion.Replacement
	// Reject no-op replacements — nothing to commit.
	if original == replacement {
		writeError(w, http.StatusBadRequest, "suggestion replacement is identical to the anchored text")
		return
	}
	pos, err := resolveAnchorInSource(doc.Content, comment.Anchor)
	if err != nil {
		writeAnchorResolveError(w, err)
		return
	}
	newContent := doc.Content[:pos] + replacement + doc.Content[pos+len(original):]
	if !strings.HasSuffix(newContent, "\n") {
		newContent += "\n"
	}

	// New child doc — mirrors createManualRevision's shape. Author
	// name and actor kind reflect the *applier* (usually a human
	// clicking Apply), not the suggestion's original author.
	now := time.Now().UTC()
	authorName := user.Name
	if authorName == "" {
		authorName = user.Login
	}
	childID := uuid.NewString()
	child := &models.Document{
		ID:          childID,
		Title:       doc.Title,
		Origin:      doc.Origin,
		SourceURL:   doc.SourceURL,
		SourceKind:  doc.SourceKind,
		Content:     newContent,
		Private:     doc.Private,
		GitHubOwner: doc.GitHubOwner,
		GitHubRepo:  doc.GitHubRepo,
		GitHubRef:   doc.GitHubRef,
		GitHubPath:  doc.GitHubPath,
		SourceSHA:   doc.SourceSHA,
		ParentID:    doc.ID,
		CreatedByID: user.ID,
		RevisionMeta: &models.RevisionMeta{
			Model:             "suggestion",
			GeneratedBy:       authorName,
			GeneratedByID:     user.ID,
			GeneratedAt:       now,
			ActorKind:         actorKindFor(r),
			AncestorSourceSHA: doc.SourceSHA,
			AncestorContent:   doc.Content,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if info, ok := tokenInfoFromRequest(r); ok {
		child.RevisionMeta.TokenID = info.TokenID
	}
	if err := a.store.InsertDocument(r.Context(), child); err != nil {
		internalError(w, "store.insert_suggestion_child", err)
		return
	}

	// Carry unresolved comments (same primitive as manual revision).
	// The applied comment itself gets marked resolved BEFORE the
	// carry, so it doesn't ride along.
	if err := a.stampSuggestionApplied(r.Context(), comment.ID, user, authorName, child.ID); err != nil {
		// Don't roll back the child — the revision is real; the
		// stamp is metadata. Log and continue.
		internalError(w, "store.stamp_suggestion_applied", err)
		return
	}
	if carried := a.copyOpenCommentsToChild(r.Context(), doc.ID, child); carried > 0 {
		a.hub.Broadcast(child.ID, "comments-updated")
	}
	// Track the token action for observability.
	if info, ok := tokenInfoFromRequest(r); ok {
		a.logTokenAction(r.Context(), info.TokenID, "suggestion.apply", child.ID)
	}
	a.hub.Broadcast(doc.ID, "doc-updated")

		// Summon the chain's standing reviewers onto the new revision.
	authorTok := ""
	if info, ok := tokenInfoFromRequest(r); ok {
		authorTok = info.TokenID
	}
	a.fanOutRevisionEvents(child, user.ID, authorTok, authorName)

	writeJSON(w, http.StatusCreated, child)
}

// stampSuggestionApplied flips the suggestion's applied fields AND
// resolves the comment atomically. The comment stays on the parent
// (where it was written) — the "applied" state travels with the
// carry-forward pipeline via the standard resolve semantics.
func (a *API) stampSuggestionApplied(ctx context.Context, commentID string, user *models.User, appliedBy, childID string) error {
	now := time.Now().UTC()
	_, err := a.store.Comments().UpdateOne(ctx,
		bson.M{"_id": commentID},
		bson.M{"$set": bson.M{
			"suggestion.applied_at":     now,
			"suggestion.applied_by_id":  user.ID,
			"suggestion.applied_by":     appliedBy,
			"suggestion.applied_doc_id": childID,
			"resolved":                  true,
			"resolved_by":               appliedBy,
			"resolved_at":               now,
			"updated_at":                now,
		}})
	return err
}

// applyAllSuggestions is POST /api/documents/:id/apply-suggestions —
// applies every open suggestion on the doc in ONE new revision.
// Each anchor is resolved against the original content (same rules as
// the single apply), then replacements are spliced in document order;
// a suggestion whose anchor is gone, ambiguous, or overlaps an earlier
// one in the batch is skipped and reported, never guessed.
func (a *API) applyAllSuggestions(w http.ResponseWriter, r *http.Request) {
	docID := mux.Vars(r)["id"]
	doc, accErr := a.checkDocAccess(r, docID)
	if accErr != nil {
		a.writeAccessError(w, r, accErr)
		return
	}
	user := a.currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "sign in required")
		return
	}
	if !a.enforceScope(w, r, models.TokenScopeAdmin) {
		return
	}

	comments, err := a.store.ListComments(r.Context(), doc.ID)
	if err != nil {
		internalError(w, "store.list_comments_for_batch_apply", err)
		return
	}
	type skippedItem struct {
		CommentID string `json:"commentId"`
		Reason    string `json:"reason"`
	}
	var skipped []skippedItem
	type candidate struct {
		c   models.Comment
		pos int
	}
	var cands []candidate
	open := 0
	for _, c := range comments {
		if c.Resolved || c.Suggestion == nil || c.Suggestion.AppliedAt != nil {
			continue
		}
		if c.Anchor.Exact == "" || c.Anchor.Exact == c.Suggestion.Replacement {
			continue
		}
		open++
		// Every position is resolved against the ORIGINAL content, so
		// a suggestion is applied exactly where it was anchored.
		pos, err := resolveAnchorInSource(doc.Content, c.Anchor)
		if err != nil {
			reason := "anchored text not found (the text changed)"
			if errors.Is(err, errAnchorAmbiguous) {
				reason = "anchored text appears several times and the comment doesn't say which one"
			}
			skipped = append(skipped, skippedItem{CommentID: c.ID, Reason: reason})
			continue
		}
		cands = append(cands, candidate{c: c, pos: pos})
	}
	if open == 0 {
		writeError(w, http.StatusBadRequest, "no open suggestions to apply on this document")
		return
	}
	// Document order. Two suggestions whose spans overlap can't both
	// apply: the earlier one wins, the later is skipped and reported.
	sortCandidates(cands, func(i, j int) bool {
		if cands[i].pos != cands[j].pos {
			return cands[i].pos < cands[j].pos
		}
		return cands[i].c.CreatedAt.Before(cands[j].c.CreatedAt)
	})
	var applied []models.Comment
	var b strings.Builder
	cursor := 0
	for _, cand := range cands {
		if cand.pos < cursor {
			skipped = append(skipped, skippedItem{
				CommentID: cand.c.ID,
				Reason:    "anchored text overlaps an earlier suggestion in this batch",
			})
			continue
		}
		b.WriteString(doc.Content[cursor:cand.pos])
		b.WriteString(cand.c.Suggestion.Replacement)
		cursor = cand.pos + len(cand.c.Anchor.Exact)
		applied = append(applied, cand.c)
	}
	b.WriteString(doc.Content[cursor:])
	working := b.String()
	if len(applied) == 0 {
		writeError(w, http.StatusUnprocessableEntity,
			"none of the suggestions' anchors match the current content")
		return
	}
	if !strings.HasSuffix(working, "\n") {
		working += "\n"
	}

	now := time.Now().UTC()
	authorName := user.Name
	if authorName == "" {
		authorName = user.Login
	}
	child := &models.Document{
		ID:          uuid.NewString(),
		Title:       doc.Title,
		Origin:      doc.Origin,
		SourceURL:   doc.SourceURL,
		SourceKind:  doc.SourceKind,
		Content:     working,
		Private:     doc.Private,
		GitHubOwner: doc.GitHubOwner,
		GitHubRepo:  doc.GitHubRepo,
		GitHubRef:   doc.GitHubRef,
		GitHubPath:  doc.GitHubPath,
		SourceSHA:   doc.SourceSHA,
		ParentID:    doc.ID,
		CreatedByID: user.ID,
		RevisionMeta: &models.RevisionMeta{
			Model:             "suggestion",
			GeneratedBy:       authorName,
			GeneratedByID:     user.ID,
			GeneratedAt:       now,
			ActorKind:         actorKindFor(r),
			AncestorSourceSHA: doc.SourceSHA,
			AncestorContent:   doc.Content,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if info, ok := tokenInfoFromRequest(r); ok {
		child.RevisionMeta.TokenID = info.TokenID
	}
	if err := a.store.InsertDocument(r.Context(), child); err != nil {
		internalError(w, "store.insert_batch_suggestion_child", err)
		return
	}

	// Stamp every applied suggestion resolved BEFORE the carry so they
	// don't ride to the child. Per-comment UpdateOne, never UpdateMany.
	for _, c := range applied {
		if err := a.stampSuggestionApplied(r.Context(), c.ID, user, authorName, child.ID); err != nil {
			internalError(w, "store.stamp_batch_suggestion", err)
			return
		}
	}
	if carried := a.copyOpenCommentsToChild(r.Context(), doc.ID, child); carried > 0 {
		a.hub.Broadcast(child.ID, "comments-updated")
	}
	if info, ok := tokenInfoFromRequest(r); ok {
		a.logTokenAction(r.Context(), info.TokenID, "suggestion.apply_all", child.ID)
	}
	a.hub.Broadcast(doc.ID, "doc-updated")

	authorTok := ""
	if info, ok := tokenInfoFromRequest(r); ok {
		authorTok = info.TokenID
	}
	a.fanOutRevisionEvents(child, user.ID, authorTok, authorName)

	appliedIDs := make([]string, 0, len(applied))
	for _, c := range applied {
		appliedIDs = append(appliedIDs, c.ID)
	}
	if skipped == nil {
		skipped = []skippedItem{}
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"document": child,
		"applied":  appliedIDs,
		"skipped":  skipped,
	})
}

// writeAnchorResolveError maps resolveAnchorInSource errors to HTTP:
// gone → 422 (as before), ambiguous → 409 (the doc is fine; the
// comment needs a re-anchor before it can be applied).
func writeAnchorResolveError(w http.ResponseWriter, err error) {
	if errors.Is(err, errAnchorAmbiguous) {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeError(w, http.StatusUnprocessableEntity, err.Error())
}

// sortCandidates is a tiny wrapper so the batch handler reads cleanly.
func sortCandidates[T any](s []T, less func(i, j int) bool) {
	sort.Slice(s, less)
}
