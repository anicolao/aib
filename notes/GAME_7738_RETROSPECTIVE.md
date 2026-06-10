# Game 7738 Retrospective

Game 7738 was a four-player turn-based test with Osric, IHG, Calculum, and
Infurium. The repository has parallel histories for the two bot clients:

- `aib/game-7738`: Infurium, player 4
- `aib2/game-7738`: Calculum, player 3

The last recorded tick is 290. The game was not yet marked over, but IHG was
one star short of victory.

## Final Observed Position

| Player | Stars | Ships | Economy | Industry | Science | Key Tech |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| IHG | 63 | 2862 | 132 | 129 | 35 | W8, M6, B5, R5 |
| Osric | 44 | 2729 | 121 | 95 | 30 | W8, M8, B2, R4 |
| Calculum | 16 | 1786 | 18 | 31 | 5 | W6, M7, B4, R4 |
| Infurium | 1 | 0 | 0 | 0 | 0 | W4, M3, B5, R6 |

## Main Failures

### Territory and Economy Fell Behind Early

By tick 60, Osric had 36 stars and IHG had 26. Infurium had 16 and Calculum had
15. Calculum then stayed near 15 stars until late in the game. The bots were
building ships, but they were not turning ships into territory or economy.

At tick 120:

| Player | Stars | Economy | Industry | Science |
| --- | ---: | ---: | ---: | ---: |
| Osric | 44 | 60 | 23 | 12 |
| IHG | 35 | 55 | 18 | 11 |
| Calculum | 15 | 12 | 15 | 3 |
| Infurium | 23 | 12 | 18 | 3 |

The economic gap was decisive before late combat mattered.

### Infurium Lost Valuable Frontier Stars Immediately

Infurium lost several high-NR stars to IHG very early:

- tick 30: `Mirfak` NR49
- tick 35: `Heze` NR45 and `Menkent` NR25
- tick 40: `Alnasl` NR45
- tick 55: `Chara` NR11

These were mostly undefended or weakly defended. The bot accepted or pursued
formal alliance signals with IHG, but IHG declared war at tick 25 and attacked
again at tick 120.

### Bot Instances Did Not Behave Like Allies

The two bot clients repeatedly negotiated border stability and then violated it
with movement:

- Infurium attacked Calculum at `Ick` on tick 34.
- Infurium and Calculum fought over `Peacock` from ticks 109 through 130.
- Calculum later took Infurium systems including `SteropeII`, `Izar`,
  `Corvid`, and `Aladfar`.

Diplomacy repeatedly promised no reinforcements or follow-up attacks, but those
promises were not enforced by the movement planner.

### Diplomacy Did Not Become Planner State

The AI produced plausible messages, but messages did not reliably alter future
orders. Agreements such as "no further attacks", border allocations, and tech
trade commitments need to become structured constraints and obligations.

### Tech Trading Was Too Vague and Too Late

Osric repeatedly requested concrete trades, especially Banking and
Experimentation in exchange for Manufacturing. The bots often answered with
ambiguous future intent, sent cash instead of the requested tech, or delayed
until the trade was strategically obsolete.

### Attacks Were Not Package-Synchronized

Late attacks against IHG often sent underpowered groups into prepared defenses.
The planner needs to reason about all friendly attackers and all visible
defenders arriving by the combat tick before deciding that an attack is useful.

## Improvement Priorities

1. Convert diplomacy into hard planner state.
   - Track forbidden target stars, border allocations, tech obligations,
     compensation promises, and alliance offers.
   - Forbid movement into promised-safe or agreed-other-party systems unless a
     later explicit override exists.

2. Coordinate controlled bot instances.
   - Prefer formal alliances with other known bot identities.
   - Treat controlled bot players as collaboration partners, not ordinary
     opportunistic targets.
   - Do not attack a collaborator except under explicit hostile evidence.

3. Improve early expansion.
   - Prioritize reachable neutral and enemy territory by weighted
     `NR + economy + industry + science`.
   - Keep expanding while high-value profitable targets remain reachable.

4. Revalue economy.
   - Economy should be valued by cash flow over multiple production cycles and
     reinvestment potential, not only by immediate damage/tick.

5. Make alliance trust conditional.
   - Formal alliance changes tactical classification, but recent aggression or
     attacks against a collaborator should keep a player in a reduced-trust
     state with border defenses preserved.

6. Synchronize attack packages.
   - Before attacking, aggregate friendly attackers, existing friendly attacks,
     local defenders, visible inbound defenders, weapons levels, and required
     margin.

7. Make tech obligations concrete.
   - If a player asks for a specific tech in exchange for a specific tech, the
     bot should create an obligation and execute it when available and safe.
   - Cash should be a fallback only when the requested tech cannot be sent.

