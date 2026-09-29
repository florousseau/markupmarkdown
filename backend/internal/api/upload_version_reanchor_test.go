package api

import (
	"testing"
	"time"

	"markupmarkdown/internal/models"
)

// TestCarriedCommentsOnNewVersion pins what happens to open comments
// when a whole new version of the file is uploaded (manual revision):
// untouched sections keep their anchor, lightly-reworded passages
// re-anchor approximately, removed passages become orphans with the
// original quote preserved, and doc-level comments always carry.
func TestCarriedCommentsOnNewVersion(t *testing.T) {
	v2 := "# Intro\n\nThis section explains the **deployment pipeline** in detail.\n\n" +
		"# Pricing\n\nThe starter plan costs twelve euros per month for small teams.\n\n" +
		"# New section\n\nSomething entirely different.\n"

	mk := func(exact string) models.Comment {
		return models.Comment{ID: exact, Anchor: models.Anchor{Exact: exact, Start: 10, End: 20}}
	}
	child := &models.Document{ID: "child", Content: v2}
	now := time.Now()

	untouched := buildCarriedComment(mk("explains the deployment pipeline"), child, now)
	if untouched.Orphan || untouched.FuzzyReanchored || untouched.Anchor.Exact != "explains the deployment pipeline" {
		t.Errorf("untouched section: got %+v", untouched)
	}

	reworded := buildCarriedComment(mk("The starter plan costs ten euros per month for small teams."), child, now)
	if reworded.Orphan || !reworded.FuzzyReanchored {
		t.Errorf("reworded passage should fuzzy re-anchor, got orphan=%v fuzzy=%v exact=%q",
			reworded.Orphan, reworded.FuzzyReanchored, reworded.Anchor.Exact)
	}
	if reworded.OriginalExact != "The starter plan costs ten euros per month for small teams." {
		t.Errorf("fuzzy re-anchor must keep the original quote, got %q", reworded.OriginalExact)
	}

	removed := buildCarriedComment(mk("The old importer is kept for backward compatibility."), child, now)
	if !removed.Orphan || removed.OriginalExact != "The old importer is kept for backward compatibility." {
		t.Errorf("removed passage should orphan with original quote, got %+v", removed)
	}

	docLevel := buildCarriedComment(models.Comment{ID: "d", Body: "overall LGTM"}, child, now)
	if docLevel.Orphan || docLevel.Body != "overall LGTM" {
		t.Errorf("doc-level comment should carry verbatim, got %+v", docLevel)
	}
}
