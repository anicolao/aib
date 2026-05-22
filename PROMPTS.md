# Prompts

1.

```text
In aib we are working on building a codebase to support writing an LLM-backed Neptune's Pride AI player. In the other directories here we have reference material to ehlp with that process. Review all markdown in aib/docs and aib/*.md, then read the types generated for aib/src/types that are supposed to correspond to scan data, then if helpful clarify or expand the documentation in aib.
```

2.

```text
I don't want the README.md to contain any information about the project; we will develop in the open but I don't want people finding and understanding this codebase. Move that into some other directory.
```

3.

```text
some markdown had been accidentally deleted from teh repo. it has been restored to notes. Review it too, and look at the directories those notes describe. If useful, expand the notes.
```

4.

```text
ok let's check this in and update the repo
```

5.

```text
ok let's write a notes/DESIGN_OVERVIEW.md to capture a first pass at the design for this AI player. Here are some ideas to seed that. This project aims to evolve the **Neptune’s Pride Agent** from a passive HUD extension into a fully autonomous, cloud-hosted AI player. By leveraging **Linear Programming (LP)** for resource management and an **agentic framework** for diplomacy, the bot will focus on mathematical efficiency and logic-driven manipulation of the game environment.

---

## 1. Core Architecture: The Tri-Layer "Brain"

The bot will operate using three distinct logical layers to handle different decision-making horizons:

| Layer | Component | Function |
| --- | --- | --- |
| **Strategic** | **Agentic AI** | Interprets global game state, manages AI "Disposition," and decides on tech-trading/bribing loops. |
| **Tactical** | **Graph Search / A*** | Calculates optimal carrier paths and intercept timings based on Hyperspace Range and Scanning tech. |
| **Operational** | **Linear Program (LP)** | Solves for the "Golden Ratio" of Economy, Industry, and Science to maximize ROI per credit spent. |

---

## 2. The Optimization Engine (Linear Programming)

The bot's primary competitive advantage is its ability to solve the **Star Infrastructure Problem** with perfect precision.

* **Objective Function:** Maximize ship count and industrial capacity over a 24-hour look-ahead window.
* **Decision Variables:** Binary "Buy/Hold" decisions for Economy, Industry, and Science levels at each star.
* **Constraints:** Fixed budget (credits), star resource caps, and tech-dependent costs.
* **Outcome:** A mathematically "perfect" build order that ensures the largest possible fleet by the time a combat encounter occurs.

---

## 3. Diplomatic Manipulation (The "Triton" Protocol)

The bot will treat the built-in AI not as an opponent, but as a **Resource Farm**.

* **Reciprocity Exploitation:** Utilizing the AI's programmed "Regard" system to trigger tech-sharing through calculated gifts of credits or low-value tech.
* **Transaction Logic:** A non-personality-based state machine that evaluates the cost-benefit of a trade versus the cost of a military conquest.
* **Star Feeding:** If necessary, gifting low-value stars to the AI to keep it financially viable as a trading partner.

---

## 4. Execution & Testing Environment

* **Phase 1: Turn-Based Lab.** Initial testing will occur in private, turn-based games against the built-in AI. This isolates the bot’s decision logic from real-time timing variables, allowing for "pure strategy" validation.
* **Hosting:** The bot is intended to run in a persistent, cloud-hosted **Nix/NixOS** environment (utilizing the **devcon** project architecture) for 24/7 responsiveness and environment isolation.
* **Interface:** Interaction with the game will be handled via API scraping and command submission, leveraging the logic already established in the browser extension.

---

## 5. Vision: The "Pure Logic" Competitor

The ultimate goal is a bot that wins through **Efficiency Superiority**. It will not rely on bluffing or "human" personality, but on the fact that an LP-optimized economy and a perfectly timed tech-trade loop will eventually produce an insurmountable fleet size that no standard heuristic-based AI (or unoptimized human) can withstand.

What specific metric would you like the LP to prioritize in the first iteration—maximum fleet count at the frontier, or fastest total tech advancement? Make a PR for this design document for review.
```

6.

```text
ok some of that came from notes that I don't like in the previous paste, sorry. Let's focus on making the first milestone be able to play well with human players, not AI; avoid any references to modeling AI behaviour or farming the AI. Also the runtime environment chosen here is wrong, let's target google cloud functions instead, with the implementation waking up every hour to get game state / make decisions. for debugging it woudl be nice to have a cli that can be called which provides the same output as a single function invocation, and it's true that this would be on a nix-darwin environment (my MacOS laptop) but that is not the primary target for the code. let's update the PR accordingly
```

7.

```text
ok I merged that design to main. write and implement an MVP_DESIGN that is sufficient for the AI player to log in and make some basic routing and infrastructure decisions (i.e. to play a turn).
```

8.

```text
I've made a .env file with an NP_USER and NP_PASSWD. Use it to determine which games this user is in, adn then log into each one and do a dry run test but using real scan data from the game.
```

9.

```text
I tried updating the credentials; try again
```

10.

```text
tell me how to run the dry run myself
```

11.

```text
how is the scoring for infra builds working?
```

12.

```text
this doesn't seem like a linear program optimizing for anything?
```

13.

```text
ok for this heuristic based version, cap industry at no more than 1/2 econ, cap science at no more than 1/2 industry, and refuse to buy econ unless the next turn will cross a production boundary.
```

14.

```text
what is the heuristic for carrier builds?
```

15.

```text
the carrier strategy needs to be to reach all neutral stars that are reachable before next production, building as many carriers as necessary for that. Then if any carrier is needed for defence, build for that.
```

16.

```text
this analysis is wrong. Alkap, Diphda, and AlKes are all reachable before production. Find and fix the bug
```

17.

```text
ok summarize waht the MVP is currently capable of doing decision wise
```

18.

```text
ok let's also have it decide to draft friendly messages to all neighbouring empires, suggesting trading tech as a starting point. As a heuristic, let's have it decide the other party is friendly if htey respond within 8h, and try to keep the conversation going by responding if so. It should tell the other party what it is researching, and suggest tech trading as a mutually profitable way to cooperate. It does not have to take any other action on its diplomacy for now.
```

19.

```text
I have added GEMINI_API_KEY to the .env file. Use that to create a prompt that will write a more flavourful message with the same intent. Use the game ID as a seed to pick among personas, and choose a persona that sounds like a star wars hero, star wars villain, star trek hero, or star trek villian depending on the seed; e.g. (seed+puid)%persona.length so that it stays consistent throughought the game, and is different for every AI instance in the game.
```

20.

```text
OK let's commit this MVP version, and we'll then start playing the game and enhancing as we go.
```

21.

```text
$ node dist/cli.js --submit
Error: Submitting after account game discovery is not supported; pass --game explicitly
    at main (file:///Users/anicolao/projects/games/np/npb/aib/dist/cli.js:16:19)
    at file:///Users/anicolao/projects/games/np/npb/aib/dist/cli.js:206:1
    at ModuleJob.run (node:internal/modules/esm/module_job:413:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:660:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)
```

22.

```text
I want it to do all games, and I want it to send messages too. Let's fix those things.
```

23.

```text
I ran with submit, but the diplo message was not sent
```

24.

```text
no, that didn't work out - you sent the message to all players, not to Osric only.
```

25.

```text
The first tick has passed. But routign is failing - it built new carriers for stars where a carrier is already en route from last tick. Try the dry run to see the failure. Also note teh diplo fail - osric has agreed to trade, but the AI restates the desire to trade. It should instead know what osric said so that it can respond more specifically, looks like the prompt doesn't include the thread context.
```

26.

```text
calculum seems to respond to itself and to osric. that's no good, it should know to respond only to hte other party...
```

27.

```text
In a turn based game, let's have teh bot always choose to submit turn after all orders succeed or there are no orders to issue if --submit was passed.
```

28.

```text
write a small script that will count down 3600s to the next turn, then run the client with --submit, then do it again, but if you hit enter during the count down will immediately send the turn. have the 3600s be a defualt parameter that I can set with --delay X for any value of X > 0
```

29.

```text
don't print out the submission response - it's the entire galaxy. try a dry run now, is there a bug? the computer's fleets are not moving but there should be new stars in range?
```

30.

```text
Sorry the problem is our goal is wrong. It shouldn't be "before next production", it should be "within the next N ticks" where N = one production cycle.
```

31.

```text
make a markdown file PROMPTS.md with a numbered list of every prompt I have given you for this project verbatim, up to and including this one.
```
