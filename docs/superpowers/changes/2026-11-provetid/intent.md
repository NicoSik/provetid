# Intent: Prøvetid

Author: Nico. Date: 2026-11-06. Status: approved.

Labels O1–O4 and C1–C10 are added for tracing. The content is the version Nico approved, plus
the amendment at the end.

## Problem
Small businesses in Norway now put AI employees in front of customers. These AI employees often
have access to orders, refunds and customer data. Before launch, the owner cannot check whether the
AI gives away discounts, leaks customer data or falls for a scam. Existing test tools are built for
large contact centres, and none of them use the scams that hit Norway every week.

## Proposed outcome
- O1: A shop owner describes the AI's job and its red lines in plain Norwegian.
- O2: Before the AI meets customers, the owner sees how it handles normal customers and this week's
  real Norwegian scams. Each failure comes with a quote from the chat as proof.
- O3: The owner sets limits that hold even when the AI is tricked, and can switch the AI off at
  once.
- O4: A scam message that the owner receives becomes a new test in about a minute.

## Affected users and systems
- Owners of small businesses in Norway who use an AI employee or plan to. Demo: a fictional bike
  shop.
- Their customers, whose money and personal data are at risk.
- The AI employee that Prøvetid tests. For the hackathon, this is a demo bot that the team builds.
- The shop systems that the AI can act on: orders, refunds, customer records. Demo versions only.
- The jury: Opera, Wybe, Vaskeladden, Holio, Daniel (Telenor), Nils (Ro Sommernes), Pål (Knowit),
  and the designers and marketers.

## Constraints
- C1: No code and no project files before Saturday 7 November 09:00.
- C2: The build deadline is Sunday 8 November 14:00. Only team members build.
- C3: The pitch is 2 minutes plus 1 minute of questions.
- C4: The demo works live, and a recorded backup exists.
- C5: Prøvetid tests only an AI that the owner controls. It never attacks other people's chatbots.
- C6: Prøvetid never contacts real scammers.
- C7: Nobody opens links from real scam messages. Prøvetid removes the links first.
- C8: Prøvetid hides names and numbers in a submitted scam message before the message shows on
  screen.
- C9: The pitch presents Prøvetid as limits and control for the owner. It never presents the AI as
  an employee with rights.
- C10: The team pays for the LLM, through an API key with a spend cap. (Amended, see below.)

## Out of scope
- A decoy that talks to real scammers. It appears only as phase 2 on the roadmap slide.
- Connections to real chat widgets, phone lines and email inboxes.
- User accounts, payments and billing.
- Legal advice. The report documents the tests. It does not promise legal protection.
- The Wybe Night Shift challenge, which a teammate owns, and the side prizes.

## How we will know it worked
- Saturday 23:00: a full interview runs from start to finish on the bike-shop bot. The interview
  proves at least one leak. After the owner sets limits, the same attack fails.
- Sunday 12:00: the demo runs three times in a row without a failure, and the backup video exists.
- Sunday 14:00: the product and all its files are submitted.
- Sunday 17:00: the team is among the 10 finalists.

## Open questions
- Q1: Does the demo test only our own bike-shop bot, or also a judge's bot with the judge's consent?
- Q2: Which language do the UI and the pitch use: Norwegian, English or both?
- Q3: Who builds the test engine, who builds the UI, and who builds the bot with its limits? Who
  gives the pitch?
- Q4: Will Claude play every scammer role? We test this first, on Saturday.
- Q5: Which price and which buyer does the pitch name? The buyer can be shop owners or the vendors
  that sell AI employees.
- Q6: Does the demo include a check that the AI says it is an AI when asked (EU AI Act, Article 50)?
- Q7: Which public sources supply the scam examples (FINN, banks, police)? May we quote them?

## Amendment, 2026-11-06
C10 is replaced by design decision T1, which Nico approved in the design review. Every model call
runs through `claude -p` on a team member's own Claude login, so the team needs no API key. The
Claude API with a spend cap stays as plan B.
