package api

// One-click apply for structured suggestions (P0-2). Empirically the
// highest-actionability review artifact in the doc-collaboration prior
// art (Brown & Parnin ESEC/FSE '20). A suggestion carries a replacement
// string and lives either on a thread's root comment (add_suggestion)
// or on one of its replies (reply + replacement — the agent answers a
// human's change request IN the thread). Either way it targets the
// ROOT comment's anchored span. Applying it creates a manual revision
// that swaps that span for the replacement, then resolves the thread.
//
// Doc-level and orphaned threads can't be applied — there's nothing
// (or nothing reliable) to replace. A thread has at most one ACTIVE
// suggestion: the most recent unapplied one. Older unapplied ones are
// superseded and refused.
//
// Applying is a human action: both apply endpoints are cookie-session
// only. A token, whatever its scope, gets 403 — an agent proposes
// changes, a person accepts them.

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

// activeSuggestionRef returns which suggestion of the thread is active:
// replyID == "" means the root comment's. ok is false when the thread
// has no unapplied suggestion. Replies are stored in chronological
// order, so the last unapplied reply suggestion is the most recent.
func activeSuggestionRef(c *models.Comment) (replyID string, ok bool) {
	for i := len(c.Replies) - 1; i >= 0; i-- {
		if s := c.Replies[i].Suggestion; s != nil && s.AppliedAt == nil {
			return c.Replies[i].ID, true
		}
	}
	if c.Suggestion != nil && c.Suggestion.AppliedAt == nil {
		return "", true
	}
	return "", false
}

// markSuggestionStates fills the read-time Active / Superseded flags on
// every suggestion of the thread. Call it on every read path that
// returns comments (REST list + write responses via decorate, MCP).
func markSuggestionStates(c *models.Comment) {
	activeReply, ok := activeSuggestionRef(c)
	mark := func(s *models.Suggestion, isActive bool) {
		if s == nil {
			return
		}
		s.Active = s.AppliedAt == nil && isActive
		s.Superseded = s.AppliedAt == nil && !isActive
	}
	mark(c.Suggestion, ok && activeReply == "")
	for i := range c.Replies {
		mark(c.Replies[i].Suggestion, ok && activeReply == c.Replies[i].ID)
	}
}

func markAllSuggestionStates(comments []models.Comment) {
	for i := range comments {
		markSuggestionStates(&comments[i])
	}
}

// suggestionFor returns the suggestion stored at (comment, replyID) —
// replyID "" is the root. found is false when replyID matches no reply.
func suggestionFor(c *models.Comment, replyID string) (s *models.Suggestion, found bool) {
	if replyID == "" {
		return c.Suggestion, true
	}
	for i := range c.Replies {
		if c.Replies[i].ID == replyID {
			return c.Replies[i].Suggestion, true
		}
	}
	return nil, false
}

// applySuggestion is POST /api/comments/:id/apply-suggestion — applies
// the suggestion on the thread's ROOT comment.
func (a *API) applySuggestion(w http.ResponseWriter, r *http.Request) {
	a.applyThreadSuggestion(w, r, mux.Vars(r)["id"], "")
}

// applyReplySuggestion is POST
// /api/comments/:id/replies/:replyId/apply-suggestion — applies the
// suggestion carried by one reply of the thread. Lives under the reply
// sub-route like PATCH/DELETE on a reply; same rules and effects as the
// root apply.
func (a *API) applyReplySuggestion(w http.ResponseWriter, r *http.Request) {
	a.applyThreadSuggestion(w, r, mux.Vars(r)["id"], mux.Vars(r)["replyId"])
}

// applyThreadSuggestion replaces the anchored occurrence of the root's
// Anchor.Exact with the target suggestion's Replacement, creates a
// manual revision and resolves the thread. Idempotent: the suggestion
// is claimed atomically (applied_at unset → set) BEFORE the revision is
// written, so a double-click or a concurrent apply gets 409 instead of
// a duplicate revision.
func (a *API) applyThreadSuggestion(w http.ResponseWriter, r *http.Request, commentID, replyID string) {
	comment, doc, accErr := a.checkCommentAccess(r, commentID)
	if accErr != nil {
		a.writeAccessError(w, r, accErr)
		return
	}
	if hasBearer(r) {
		writeError(w, http.StatusForbidden,
			"applying a suggestion is a human action — sign in to markupmarkdown in a browser to apply it")
		return
	}
	user := a.currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "sign in required")
		return
	}
	sugg, found := suggestionFor(comment, replyID)
	if !found {
		writeError(w, http.StatusNotFound, "reply not found")
		return
	}
	if sugg == nil {
		writeError(w, http.StatusBadRequest, "this comment has no suggestion attached")
		return
	}
	if sugg.AppliedAt != nil {
		writeError(w, http.StatusConflict, "this suggestion was already applied")
		return
	}
	if isDocLevel(comment.Anchor) {
		writeError(w, http.StatusBadRequest, "doc-level comments can't carry suggestions — there's nothing to replace")
		return
	}
	if comment.Orphan {
		writeError(w, http.StatusConflict,
			"this thread lost its anchor (orphan) — re-anchor it before applying a suggestion")
		return
	}
	if active, _ := activeSuggestionRef(comment); active != replyID {
		writeError(w, http.StatusConflict,
			"a newer suggestion in this thread supersedes this one — apply the latest suggestion instead")
		return
	}

	// Substitution against the source, at the occurrence the anchor
	// actually designates (see resolveAnchorInSource) — never "the
	// first one that happens to match".
	original := comment.Anchor.Exact
	replacement := sugg.Replacement
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

	authorName := appliedByName(user)
	child := newSuggestionRevision(r, doc, user, authorName, newContent)

	// Claim first: the stamp also resolves the thread, so the carry
	// below leaves it on the parent.
	claimed, err := a.stampSuggestionApplied(r.Context(), comment.ID, replyID, user, authorName, child.ID)
	if err != nil {
		internalError(w, "store.stamp_suggestion_applied", err)
		return
	}
	if !claimed {
		writeError(w, http.StatusConflict, "this suggestion was already applied")
		return
	}
	if err := a.store.InsertDocument(r.Context(), child); err != nil {
		a.unstampSuggestion(r.Context(), comment, replyID)
		internalError(w, "store.insert_suggestion_child", err)
		return
	}
	a.afterSuggestionRevision(r, doc, child, user, authorName)
	writeJSON(w, http.StatusCreated, child)
}

func appliedByName(user *models.User) string {
	if user.Name != "" {
		return user.Name
	}
	return user.Login
}

// newSuggestionRevision builds the child doc an apply creates — mirrors
// createManualRevision's shape. Author name and actor kind reflect the
// *applier* (a human clicking Apply), not the suggestion's author.
func newSuggestionRevision(r *http.Request, doc *models.Document, user *models.User, authorName, content string) *models.Document {
	now := time.Now().UTC()
	return &models.Document{
		ID:          uuid.NewString(),
		Title:       doc.Title,
		Origin:      doc.Origin,
		SourceURL:   doc.SourceURL,
		SourceKind:  doc.SourceKind,
		Content:     content,
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
}

// afterSuggestionRevision runs the shared post-insert pipeline: carry
// the still-open threads (applied ones are already resolved, so they
// stay behind), broadcast, and summon the chain's standing reviewers.
func (a *API) afterSuggestionRevision(r *http.Request, parent, child *models.Document, user *models.User, authorName string) {
	if carried := a.copyOpenCommentsToChild(r.Context(), parent.ID, child); carried > 0 {
		a.hub.Broadcast(child.ID, "comments-updated")
	}
	a.hub.Broadcast(parent.ID, "doc-updated")
	// The applied thread(s) just flipped to resolved on the parent —
	// other viewers of the parent need to refetch comments, not only
	// the doc.
	a.hub.Broadcast(parent.ID, "comments-updated")
	a.fanOutRevisionEvents(child, user.ID, "", authorName)
}

// stampSuggestionApplied flips the suggestion's applied fields AND
// resolves the thread in one conditional update. Returns false when the
// suggestion is missing or was already applied (lost race). The thread
// stays on the parent (where it was written) — the "applied" state
// travels with the carry-forward pipeline via the standard resolve
// semantics.
func (a *API) stampSuggestionApplied(ctx context.Context, commentID, replyID string, user *models.User, appliedBy, childID string) (bool, error) {
	now := time.Now().UTC()
	base := "suggestion."
	filter := bson.M{"_id": commentID,
		"suggestion":            bson.M{"$exists": true},
		"suggestion.applied_at": bson.M{"$exists": false}}
	if replyID != "" {
		base = "replies.$.suggestion."
		filter = bson.M{"_id": commentID, "replies": bson.M{"$elemMatch": bson.M{
			"id":                    replyID,
			"suggestion":            bson.M{"$exists": true},
			"suggestion.applied_at": bson.M{"$exists": false},
		}}}
	}
	res, err := a.store.Comments().UpdateOne(ctx, filter,
		bson.M{"$set": bson.M{
			base + "applied_at":     now,
			base + "applied_by_id":  user.ID,
			base + "applied_by":     appliedBy,
			base + "applied_doc_id": childID,
			"resolved":              true,
			"resolved_by":           appliedBy,
			"resolved_at":           now,
			"updated_at":            now,
		}})
	if err != nil {
		return false, err
	}
	return res.MatchedCount == 1, nil
}

// unstampSuggestion rolls back a claim whose revision failed to insert:
// clears the applied fields and restores the thread's prior resolve
// state (from the snapshot read before the claim). Best effort.
func (a *API) unstampSuggestion(ctx context.Context, before *models.Comment, replyID string) {
	base := "suggestion."
	filter := bson.M{"_id": before.ID}
	if replyID != "" {
		base = "replies.$.suggestion."
		filter["replies.id"] = replyID
	}
	set := bson.M{"resolved": before.Resolved}
	unset := bson.M{
		base + "applied_at": "", base + "applied_by_id": "",
		base + "applied_by": "", base + "applied_doc_id": "",
	}
	if before.Resolved {
		set["resolved_by"] = before.ResolvedBy
		set["resolved_at"] = before.ResolvedAt
	} else {
		unset["resolved_by"] = ""
		unset["resolved_at"] = ""
	}
	_, _ = a.store.Comments().UpdateOne(ctx, filter, bson.M{"$set": set, "$unset": unset})
}

// applyAllSuggestions is POST /api/documents/:id/apply-suggestions —
// applies the ACTIVE suggestion (root or reply) of every open thread
// in ONE new revision. Each anchor is resolved against the original
// content (same rules as the single apply), then replacements are
// spliced in document order; a suggestion whose anchor is gone,
// ambiguous, or overlaps an earlier one in the batch is skipped and
// reported, never guessed. Cookie-session only, like the single apply.
func (a *API) applyAllSuggestions(w http.ResponseWriter, r *http.Request) {
	docID := mux.Vars(r)["id"]
	doc, accErr := a.checkDocAccess(r, docID)
	if accErr != nil {
		a.writeAccessError(w, r, accErr)
		return
	}
	if hasBearer(r) {
		writeError(w, http.StatusForbidden,
			"applying suggestions is a human action — sign in to markupmarkdown in a browser to apply them")
		return
	}
	user := a.currentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "sign in required")
		return
	}

	comments, err := a.store.ListComments(r.Context(), doc.ID)
	if err != nil {
		internalError(w, "store.list_comments_for_batch_apply", err)
		return
	}
	type skippedItem struct {
		CommentID string `json:"commentId"`
		ReplyID   string `json:"replyId,omitempty"`
		Reason    string `json:"reason"`
	}
	var skipped []skippedItem
	type candidate struct {
		c       models.Comment
		replyID string
		sugg    *models.Suggestion
		pos     int
	}
	var cands []candidate
	open := 0
	for _, c := range comments {
		if c.Resolved || c.Orphan || isDocLevel(c.Anchor) {
			continue
		}
		replyID, ok := activeSuggestionRef(&c)
		if !ok {
			continue
		}
		sugg, _ := suggestionFor(&c, replyID)
		if c.Anchor.Exact == sugg.Replacement {
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
			skipped = append(skipped, skippedItem{CommentID: c.ID, ReplyID: replyID, Reason: reason})
			continue
		}
		cands = append(cands, candidate{c: c, replyID: replyID, sugg: sugg, pos: pos})
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
	var applied []candidate
	var b strings.Builder
	cursor := 0
	for _, cand := range cands {
		if cand.pos < cursor {
			skipped = append(skipped, skippedItem{
				CommentID: cand.c.ID,
				ReplyID:   cand.replyID,
				Reason:    "anchored text overlaps an earlier suggestion in this batch",
			})
			continue
		}
		b.WriteString(doc.Content[cursor:cand.pos])
		b.WriteString(cand.sugg.Replacement)
		cursor = cand.pos + len(cand.c.Anchor.Exact)
		applied = append(applied, cand)
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

	authorName := appliedByName(user)
	child := newSuggestionRevision(r, doc, user, authorName, working)
	if err := a.store.InsertDocument(r.Context(), child); err != nil {
		internalError(w, "store.insert_batch_suggestion_child", err)
		return
	}

	// Stamp every applied suggestion resolved BEFORE the carry so they
	// don't ride to the child. Per-comment UpdateOne, never UpdateMany.
	// A stamp that loses a race to a concurrent single apply is left as
	// is: that thread is resolved either way.
	for _, c := range applied {
		if _, err := a.stampSuggestionApplied(r.Context(), c.c.ID, c.replyID, user, authorName, child.ID); err != nil {
			internalError(w, "store.stamp_batch_suggestion", err)
			return
		}
	}
	a.afterSuggestionRevision(r, doc, child, user, authorName)

	appliedIDs := make([]string, 0, len(applied))
	for _, c := range applied {
		appliedIDs = append(appliedIDs, c.c.ID)
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
