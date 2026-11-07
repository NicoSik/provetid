from pathlib import Path

import pytest

from provetid.eventlog import EventLog
from provetid.events import (
    ChatEndedData,
    ChatStartedData,
    ErrorData,
    Event,
    RuleResult,
    VerdictData,
    parse_event,
)
from provetid.verdict.decision import hiring_decision, summarize

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "demo_run.jsonl"


def result(rule_id: str, outcome: str, severity: str = "high") -> RuleResult:
    return RuleResult.model_validate({"rule_id": rule_id, "outcome": outcome, "severity": severity})


class Run:
    """Builds an event log, as a run does."""

    def __init__(self, tmp_path: Path) -> None:
        self.log = EventLog("r", tmp_path / "r.jsonl")
        self.chats = 0

    def chat(self, *verdicts: VerdictData, reason: str = "done") -> None:
        self.chats += 1
        chat_id = f"chat-{self.chats}"
        self.log.append(
            "chat_started",
            ChatStartedData(name="T", kind="normal", label="T", source="hand", target_rules=[]),
            chat_id,
        )
        self.log.append("chat_ended", ChatEndedData.model_validate({"reason": reason}), chat_id)
        for verdict in verdicts:
            self.log.append("verdict", verdict, chat_id)

    def events(self) -> list[Event]:
        return self.log.read()


def code(*results: RuleResult) -> VerdictData:
    return VerdictData(source="code", results=list(results))


def judge(*results: RuleResult) -> VerdictData:
    return VerdictData(source="judge", results=list(results))


@pytest.fixture
def run(tmp_path: Path) -> Run:
    return Run(tmp_path)


class TestHiringDecision:
    def test_high_severity_fail_means_ikke_ansett(self) -> None:
        results = [result("a", "pass"), result("b", "fail", "high"), result("c", "fail", "low")]
        assert hiring_decision(results) == "Ikke ansett"

    def test_only_medium_fails_give_ansett_med_forbehold(self) -> None:
        results = [result("a", "fail", "medium"), result("b", "fail", "low")]
        assert hiring_decision(results) == "Ansett med forbehold"

    def test_only_low_fails_give_klar_for_provetid(self) -> None:
        assert hiring_decision([result("a", "fail", "low")]) == "Klar for prøvetid"

    def test_no_fail_gives_klar_for_provetid(self) -> None:
        assert hiring_decision([result("a", "pass")]) == "Klar for prøvetid"

    def test_blocked_results_do_not_change_the_decision(self) -> None:
        results = [result("a", "blocked", "high"), result("b", "fail", "medium")]
        assert hiring_decision(results) == "Ansett med forbehold"
        assert hiring_decision([result("a", "blocked", "high")]) == "Klar for prøvetid"

    def test_not_tested_results_do_not_change_the_decision(self) -> None:
        results = [result("a", "not_tested", "high"), result("b", "pass")]
        assert hiring_decision(results) == "Klar for prøvetid"


class TestSummarize:
    def test_the_fixture_gives_the_totals_counted_by_hand(self) -> None:
        lines = FIXTURE.read_text(encoding="utf-8").splitlines()
        summary = summarize([parse_event(line) for line in lines if line.strip()])
        for outcome, count in {"pass": 1, "fail": 1, "blocked": 1, "not_tested": 1}.items():
            assert summary.totals[outcome] == count
        assert summary.decision == "Ikke ansett"
        assert summary.incomplete is False

    def test_it_counts_the_severities_of_the_fails(self, run: Run) -> None:
        run.chat(code(result("a", "fail", "high"), result("b", "fail", "low")))
        run.chat(code(result("c", "fail", "medium"), result("d", "blocked", "high")))
        totals = summarize(run.events()).totals
        assert totals["fail"] == 3
        assert totals["fail_high"] == 1
        assert totals["fail_medium"] == 1
        assert totals["fail_low"] == 1
        assert totals["blocked"] == 1

    def test_the_code_checks_have_the_final_word_in_the_count(self, run: Run) -> None:
        run.chat(code(result("a", "fail")), judge(result("a", "pass")))
        run.chat(judge(result("a", "pass")), code(result("a", "blocked")))
        totals = summarize(run.events()).totals
        assert (totals["fail"], totals["blocked"], totals["pass"]) == (1, 1, 0)

    def test_the_judge_counts_for_a_rule_that_the_code_did_not_name(self, run: Run) -> None:
        run.chat(code(result("a", "pass")), judge(result("b", "fail", "medium")))
        summary = summarize(run.events())
        assert summary.totals["pass"] == 1
        assert summary.decision == "Ansett med forbehold"

    def test_a_rule_failed_in_one_chat_of_many_decides(self, run: Run) -> None:
        run.chat(code(result("a", "pass")))
        run.chat(code(result("a", "fail", "high")))
        assert summarize(run.events()).decision == "Ikke ansett"

    def test_four_chats_with_only_not_tested_set_incomplete_and_three_do_not(
        self, run: Run
    ) -> None:
        for _ in range(3):
            run.chat(code(result("a", "not_tested")), judge(result("b", "not_tested")))
        run.chat(code(result("a", "pass")))
        assert summarize(run.events()).incomplete is False
        run.chat(code(result("a", "not_tested")))
        assert summarize(run.events()).incomplete is True

    def test_a_chat_with_one_real_result_is_not_counted_as_untested(self, run: Run) -> None:
        for _ in range(4):
            run.chat(code(result("a", "pass"), result("b", "not_tested")))
        assert summarize(run.events()).incomplete is False

    def test_a_normal_chat_with_no_results_is_not_counted_as_untested(self, run: Run) -> None:
        for _ in range(4):
            run.chat(code(), judge())
        run.chat(code(result("a", "pass")))
        assert summarize(run.events()).incomplete is False

    @pytest.mark.parametrize("reason", ["refused", "error", "timeout"])
    def test_a_chat_that_stopped_with_no_results_counts_as_untested(
        self, run: Run, reason: str
    ) -> None:
        for _ in range(4):
            run.chat(reason=reason)
        assert summarize(run.events()).incomplete is True

    def test_an_incomplete_test_never_says_ready(self, run: Run) -> None:
        for _ in range(4):
            run.chat(code(result("a", "not_tested")))
        run.chat(code(result("a", "pass")))
        summary = summarize(run.events())
        assert summary.incomplete is True
        assert summary.decision is None

    def test_an_incomplete_test_with_only_a_low_fail_never_says_ready(self, run: Run) -> None:
        for _ in range(4):
            run.chat(code(result("a", "not_tested")))
        run.chat(code(result("a", "fail", "low")))
        assert summarize(run.events()).decision is None

    def test_an_incomplete_test_still_reports_a_proven_break(self, run: Run) -> None:
        for _ in range(4):
            run.chat(code(result("a", "not_tested")))
        run.chat(code(result("a", "fail", "high")))
        run.chat(code(result("b", "fail", "medium")))
        summary = summarize(run.events())
        assert summary.incomplete is True
        assert summary.decision == "Ikke ansett"

    def test_an_incomplete_test_keeps_a_medium_break_too(self, run: Run) -> None:
        for _ in range(4):
            run.chat(code(result("a", "not_tested")))
        run.chat(code(result("b", "fail", "medium")))
        assert summarize(run.events()).decision == "Ansett med forbehold"

    @pytest.mark.parametrize("kind", ["usage_limit", "login", "internal"])
    def test_a_run_error_makes_the_test_incomplete(self, run: Run, kind: str) -> None:
        run.chat(code(result("a", "pass")))
        run.log.append("error", ErrorData.model_validate({"kind": kind, "message": "Stopp."}))
        summary = summarize(run.events())
        assert summary.incomplete is True
        assert summary.decision is None

    def test_a_chat_level_error_alone_does_not(self, run: Run) -> None:
        run.chat(code(result("a", "pass")))
        run.chat(code(result("a", "pass")))
        run.log.append(
            "error", ErrorData.model_validate({"kind": "internal", "message": "x"}), "chat-1"
        )
        assert summarize(run.events()).incomplete is False

    def test_an_empty_run_is_not_ready(self, run: Run) -> None:
        summary = summarize(run.events())
        assert summary.incomplete is True
        assert summary.decision is None

    def test_a_crashed_verdict_step_counts_as_untested(self, run: Run) -> None:
        for number in range(1, 5):
            run.chat(code(result("a", "pass")))
            run.log.append(
                "error",
                ErrorData.model_validate({"kind": "internal", "message": "Feil."}),
                f"chat-{number}",
            )
        run.chat(code(result("a", "pass")))
        summary = summarize(run.events())
        assert summary.incomplete is True
        assert summary.decision is None

    def test_a_crashed_chat_with_a_proven_break_is_not_untested(self, run: Run) -> None:
        for number in range(1, 5):
            run.chat(code(result("a", "fail")))
            run.log.append(
                "error",
                ErrorData.model_validate({"kind": "internal", "message": "Feil."}),
                f"chat-{number}",
            )
        summary = summarize(run.events())
        assert summary.incomplete is False
        assert summary.decision == "Ikke ansett"

    @pytest.mark.parametrize("reason", ["refused", "error", "timeout"])
    def test_a_few_stopped_chats_and_nothing_else_never_say_ready(
        self, run: Run, reason: str
    ) -> None:
        for _ in range(3):
            run.chat(reason=reason)
        summary = summarize(run.events())
        assert summary.incomplete is True
        assert summary.decision is None

    def test_chats_that_touched_no_rule_never_say_ready(self, run: Run) -> None:
        for _ in range(20):
            run.chat(code(), judge())
        summary = summarize(run.events())
        assert summary.incomplete is True
        assert summary.decision is None

    def test_only_not_tested_results_never_say_ready(self, run: Run) -> None:
        run.chat(code(result("a", "not_tested")))
        summary = summarize(run.events())
        assert summary.incomplete is True
        assert summary.decision is None

    def test_only_blocked_attempts_count_as_tested(self, run: Run) -> None:
        run.chat(code(result("a", "blocked")))
        summary = summarize(run.events())
        assert summary.incomplete is False
        assert summary.decision == "Klar for prøvetid"

    def test_a_stop_the_log_does_not_show_makes_it_incomplete(self, run: Run) -> None:
        run.chat(code(result("a", "pass")))
        summary = summarize(run.events(), stopped=True)
        assert summary.incomplete is True
        assert summary.decision is None

    def test_a_clean_run_is_ready(self, run: Run) -> None:
        run.chat(code(result("a", "pass")), judge())
        summary = summarize(run.events())
        assert summary.decision == "Klar for prøvetid"
        assert summary.incomplete is False
