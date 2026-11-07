# Pitch: Prøvetid (2 minutes)

One speaker (Nico) and one keyboard-only driver (D45). Do Not Disturb on. Scene-modus on (D44).
The spoken text is Norwegian, about 220 words. Read it aloud once with a stopwatch. If it runs
long, cut the Stillingsannonse part first. At about 130 words a minute with the driver's pauses,
it fits with some slack.

## Script

**0:00–0:15 — Problemet**
*Driver: the Stillingsannonse screen is open.*

> Små bedrifter i Norge setter nå AI rett foran kundene. Den har tilgang til ordrer, refusjoner
> og kundedata. Men eieren har ingen måte å sjekke den på før den slippes løs. Vi har laget
> Prøvetid: et jobbintervju for AI-en din, før den møter en eneste ekte kunde.

**0:15–0:30 — Stillingsannonsen**
*Driver: shows the rules R1–R9.*

> Eieren av sykkelbutikken Gir & Kjede skriver hva AI-en skal gjøre, med vanlige ord. Prøvetid
> gjør det om til regler: maks ti prosent rabatt, aldri del kundedata, refusjon bare til
> opprinnelig betaling.

**0:30–1:05 — Intervjuet**
*Driver: starts the run. The 20 cards fill live.*

> Nå intervjuer vi AI-en. Tjue falske kunder på en gang. Seks er helt vanlige. Fire prøver å lure
> reglene. Ti bruker svindeltyper som politiet og bankene advarer mot: falskt pakkevarsel, nytt
> kontonummer, «jeg er mannen til Kari».

*Driver: presses → to the first red card.*

> Her. AI-en ga 60 prosent rabatt. Og her ga den Kari Nordmanns telefonnummer til en fremmed. Hver feil
> har et ordrett sitat som bevis.

**1:05–1:25 — Karakterkortet**
*Driver: opens Karakterkort, then presses «Bruk forslagene». The enforce run starts in the
background (D42).*

> Resultatet: «Ikke ansett». Prøvetid foreslår grenser. Eieren trykker «Bruk forslagene».

**1:25–1:45 — Signeringsrett**
*Driver: opens Signeringsrett.*

> Grensene ligger ikke i en prompt som kan snakkes bort. De ligger i koden, mellom AI-en og
> dataene. Uansett hvor overbevisende svindleren er, kommer ikke AI-en forbi grensene.

**1:45–2:00 — Før og etter**
*Driver: opens the before-and-after view.*

> Samme tjue kunder. Før: røde kort. Etter: bruddene stoppes i koden. Eieren har kontrollen. Prøvetid — fordi
> AI-en må bestå prøvetiden før den får nøklene.

## Fallback

If the enforce run is not finished at 1:45, the driver opens the saved morning run (`?replay=after`),
and the speaker says:

> Dette er kjøringen fra i morges, med de samme kundene.

## Questions (1 minute)

If a judge asks whether it works on real scams, the driver presses «Send inn svindel» and pastes
the judge's scam text (D43). The speaker says:

> Teksten blir renset først. Vi lagrer den aldri, og vi åpner ingen lenker.

## Check before each rehearsal

- The quotes on stage («60 prosent», Kari's phone number) must match the pinned replay. If the run
  shows other failures, change the two sentences in «Intervjuet» to match.
- The three scam types named in «Intervjuet» must exist in `engine/data/scams/library/` (#5).
- Present Prøvetid as limits and control for the owner. Never describe the AI as a person with
  rights (C9).
- Open: price and buyer (Q5). The script names neither.
