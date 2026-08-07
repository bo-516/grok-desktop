"""
Structural acceptance tests for the UI/UX design artifact.

Drives the real shipped design document under docs/design/ — not a re-implementation
of expected prose. Fails if required surfaces, reference mappings, tokens, or
session states are missing from the source of truth.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

# Design package root: docs/design/
_DESIGN_DIR = Path(__file__).resolve().parents[1]
_DOC_PATH = _DESIGN_DIR / "ui-ux-agent-client.md"
_WIREFRAME_PATH = _DESIGN_DIR / "wireframe-shell.html"


def _read_design() -> str:
    """Load the primary design markdown; missing file is a hard failure."""
    if not _DOC_PATH.is_file():
        raise FileNotFoundError(f"Design artifact missing: {_DOC_PATH}")
    return _DOC_PATH.read_text(encoding="utf-8")


class UiUxDesignArtifactTests(unittest.TestCase):
    """Verify the in-repo design doc meets goal acceptance criteria."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = _read_design()

    def test_design_doc_exists_and_is_substantive(self) -> None:
        """Primary design artifact must exist and be large enough to be a real IA doc."""
        self.assertTrue(_DOC_PATH.is_file())
        self.assertGreater(len(self.doc), 8000)
        self.assertGreaterEqual(len(self.doc.splitlines()), 200)

    def test_primary_surfaces_documented(self) -> None:
        """Acceptance: layout, session list, timeline/tools, plan, permission, composer, mode, diff."""
        required_phrases = [
            "Default regions",
            "Session list",
            "Timeline",
            "Tool card",
            "Plan panel",
            "Permission",
            "Composer",
            "Diff review",
            "State matrix",
        ]
        for phrase in required_phrases:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.doc)

    def test_session_status_model(self) -> None:
        """Acceptance: idle / streaming / waiting_permission / disconnected are specified."""
        for status in ("idle", "streaming", "waiting_permission", "disconnected"):
            with self.subTest(status=status):
                self.assertIn(status, self.doc)

    def test_mode_and_model_chrome(self) -> None:
        """Mode Ask/Plan/Build and model controls appear in the design."""
        self.assertIn("Ask", self.doc)
        self.assertIn("Plan", self.doc)
        self.assertIn("Build", self.doc)
        self.assertTrue(
            "Model" in self.doc or "model" in self.doc,
            "model chrome missing",
        )

    def test_reference_products_with_concrete_patterns(self) -> None:
        """
        Acceptance: Codex, Claude, Antigravity each appear with a borrowed pattern,
        not a name-drop only.
        """
        # Codex: command center / orchestration / in-thread diff
        self.assertRegex(
            self.doc,
            re.compile(
                r"Codex.{0,200}(command center|orchestration|diff|sidebar)",
                re.IGNORECASE | re.DOTALL,
            ),
        )
        # Claude: multi-session sidebar / panes / permission modes
        self.assertRegex(
            self.doc,
            re.compile(
                r"Claude.{0,200}(session|sidebar|permission|pane|multi-session)",
                re.IGNORECASE | re.DOTALL,
            ),
        )
        # Antigravity: Manager / agent-first / artifacts
        self.assertRegex(
            self.doc,
            re.compile(
                r"Antigravity.{0,200}(Manager|agent-first|artifact|Editor)",
                re.IGNORECASE | re.DOTALL,
            ),
        )

    def test_pattern_mapping_table_present(self) -> None:
        """Explicit pattern ← product mapping section exists."""
        self.assertRegex(self.doc, r"Pattern.*product mapping|pattern.*product", re.I)
        self.assertIn("Mission Control", self.doc)

    def test_semantic_tokens_and_no_adhoc_hex_guidance(self) -> None:
        """Visual direction uses defineColor.css semantic tokens; forbids ad-hoc colors in TSX."""
        self.assertIn("defineColor.css", self.doc)
        self.assertIn("--color-", self.doc)
        self.assertTrue(
            "TSX must not" in self.doc or "must not use" in self.doc.lower(),
            "missing forbid-ad-hoc-color guidance",
        )
        # Named semantic roles expected for implementers
        for role in (
            "--color-bg-app",
            "--color-bg-surface",
            "--color-text-primary",
            "--color-accent",
            "--color-danger",
            "--color-diff-add",
        ):
            with self.subTest(role=role):
                self.assertIn(role, self.doc)

    def test_scope_is_ui_ux_not_full_implementation(self) -> None:
        """Design goal must not claim full Tauri/ACP implementation is done."""
        self.assertTrue(
            "Not in scope" in self.doc or "visual & interaction design only" in self.doc.lower(),
            "scope boundaries missing",
        )
        # Should not present itself as completed M4 product
        self.assertNotRegex(
            self.doc,
            re.compile(r"full Tauri \+ React \+ ACP runtime.*(complete|done|shipped)", re.I),
        )

    def test_wireframe_stub_exists(self) -> None:
        """Optional visual stub listed in design package for implementer orientation."""
        self.assertTrue(_WIREFRAME_PATH.is_file())
        self.assertGreater(_WIREFRAME_PATH.stat().st_size, 1000)
        html = _WIREFRAME_PATH.read_text(encoding="utf-8")
        # Wireframe should depict the three-region shell concepts
        self.assertIn("Sessions", html)
        self.assertIn("Plan", html)
        self.assertTrue("composer" in html.lower() or "Message grok" in html)


if __name__ == "__main__":
    unittest.main()
