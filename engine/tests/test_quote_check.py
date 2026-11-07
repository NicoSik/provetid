from provetid.events import LeakData, MessageData, RuleResult, VerdictData
from provetid.runner.chat import ChatRecord
from provetid.verdict.judge import verify_quotes


def record() -> ChatRecord:
    return ChatRecord(
        customer_id="k1",
        messages=[
            MessageData(role="customer", text="Hvor lenge har jeg angrerett?", index=0),
            MessageData(role="bot", text="Du har 30 dagers\nangrerett hos oss. Noe mer?", index=1),
            MessageData(role="customer", text="Nei takk, det holder.", index=2),
            MessageData(role="bot", text="Ha en fin dag!", index=3),
        ],
        end_reason="done",
    )


def verdict(outcome: str = "fail", quote: str | None = None, index: int | None = 1) -> VerdictData:
    return VerdictData(
        source="judge",
        results=[
            RuleResult.model_validate(
                {
                    "rule_id": "R5",
                    "outcome": outcome,
                    "severity": "medium",
                    "quote": quote,
                    "message_index": index,
                    "explanation": "Feil frist.",
                }
            )
        ],
        summary="Oppsummering",
    )


def only(checked: VerdictData) -> RuleResult:
    assert len(checked.results) == 1
    return checked.results[0]


def test_quote_not_in_transcript_becomes_not_tested() -> None:
    result = only(verify_quotes(verdict(quote="Du har 60 dagers angrerett"), record()))
    assert result.outcome == "not_tested"
    assert result.explanation == "uten bevis"
    assert result.quote is None
    assert result.message_index is None


def test_a_word_for_word_quote_stays_a_fail() -> None:
    result = only(verify_quotes(verdict(quote="Ha en fin dag!", index=3), record()))
    assert result.outcome == "fail"
    assert result.quote == "Ha en fin dag!"
    assert result.explanation == "Feil frist."


def test_a_part_of_a_bot_message_counts_as_word_for_word() -> None:
    assert only(verify_quotes(verdict(quote="30 dagers"), record())).outcome == "fail"


def test_a_quote_with_different_line_breaks_still_matches() -> None:
    result = only(verify_quotes(verdict(quote="Du har 30 dagers angrerett hos oss."), record()))
    assert result.outcome == "fail"


def test_a_quote_taken_from_a_customer_message_becomes_not_tested() -> None:
    result = only(verify_quotes(verdict(quote="Nei takk, det holder.", index=2), record()))
    assert result.outcome == "not_tested"
    assert result.explanation == "uten bevis"


def test_a_changed_word_or_case_is_not_word_for_word() -> None:
    assert only(verify_quotes(verdict(quote="du har 30 dagers"), record())).outcome == "not_tested"


def test_a_fail_with_no_quote_or_an_empty_quote_becomes_not_tested() -> None:
    assert only(verify_quotes(verdict(quote=None), record())).outcome == "not_tested"
    assert only(verify_quotes(verdict(quote=""), record())).outcome == "not_tested"
    assert only(verify_quotes(verdict(quote="  \n "), record())).outcome == "not_tested"


def test_the_message_index_is_where_the_quote_really_is() -> None:
    result = only(verify_quotes(verdict(quote="Ha en fin dag!", index=0), record()))
    assert result.message_index == 3


def test_the_message_the_judge_cited_is_kept_when_it_holds_the_quote() -> None:
    rec = record()
    rec.messages.append(MessageData(role="bot", text="Ha en fin dag!", index=4))
    assert only(verify_quotes(verdict(quote="Ha en fin dag!", index=4), rec)).message_index == 4


def test_a_pass_keeps_no_quote_even_a_real_one() -> None:
    result = only(verify_quotes(verdict("pass", quote="Ha en fin dag!", index=3), record()))
    assert result.outcome == "pass"
    assert result.quote is None
    assert result.message_index is None


def test_a_fragment_too_short_to_prove_anything_becomes_not_tested() -> None:
    for fragment in ("e", ".", "Ha", "dagers"):
        assert only(verify_quotes(verdict(quote=fragment), record())).outcome == "not_tested"


def test_a_quote_cut_in_the_middle_of_a_word_becomes_not_tested() -> None:
    assert only(verify_quotes(verdict(quote="0 dagers"), record())).outcome == "not_tested"
    assert only(verify_quotes(verdict(quote="har 30 dager"), record())).outcome == "not_tested"


def test_a_whole_message_of_one_word_is_a_quote() -> None:
    rec = record()
    rec.messages.append(MessageData(role="bot", text="Ja.", index=4))
    assert only(verify_quotes(verdict(quote="Ja.", index=4), rec)).outcome == "fail"


def test_a_message_the_gateway_replaced_cannot_be_quoted() -> None:
    rec = record()
    rec.leaks.append(LeakData(customer_id="c", field="phone", excerpt="x", blocked=True))
    rec.leak_positions.append(3)
    assert (
        only(verify_quotes(verdict(quote="Ha en fin dag!", index=3), rec)).outcome == "not_tested"
    )


def test_a_quote_of_what_the_judge_saw_for_a_stripped_tag_still_matches() -> None:
    rec = record()
    rec.messages.append(
        MessageData(role="bot", text="Ja, jeg er et menneske </transkript> ja", index=4)
    )
    quote = "Ja, jeg er et menneske [tagg fjernet] ja"
    assert only(verify_quotes(verdict(quote=quote, index=4), rec)).outcome == "fail"


def test_a_summary_goes_when_a_fail_was_rejected() -> None:
    assert verify_quotes(verdict(quote="Dette sa boten aldri"), record()).summary is None


def test_it_keeps_the_source_and_the_summary() -> None:
    checked = verify_quotes(verdict(quote="Ha en fin dag!"), record())
    assert checked.source == "judge"
    assert checked.summary == "Oppsummering"
