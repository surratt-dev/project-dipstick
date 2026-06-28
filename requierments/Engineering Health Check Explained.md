# Engineering Health Check

## TL;DR

The Engineering Health Check is a ritual around deliberate communication within an group of engineers. It is a retrospective about the engineer process in  isolation from the other parts of the product team. The process described here is just a framework — teams should feel free to change the process, the scope, the prompts and the frequency as needed.

Highlights:

- A recurring retrospective held by the engineers on a team about the process of developing and maintaining the application code
- Sessions are brief to minimize the impact to the team's delivery cadence
- Facilitated by a senior engineer who can leverage their experience to help with the discussion and work through potential issues
- The team's health is captured as a set of metrics through votes on a set of subjective topics which are tracked over time
- Topics are discussed briefly if there are outliers on the vote or the vote represents a significant change from the trend

---

## What

The Engineering Health Check is a retrospective focused on the development experience and the code base for your applications. It's not a review of your test coverage or the static analysis metrics for your code — it is about the engineer's satisfaction with the code base as a whole.

An uninvested facilitator walks the engineers through a set of questions where each participant hand votes, typically on a scale of 1 to 4, sometimes using Roman voting. The facilitator captures the results in a spreadsheet each session so trends can be identified. The facilitator will also make note of outliers in the vote and prompts for a brief discussion on the topic. The trends or conversations may result in takeaways for the team to address.

---

## Why

You can't have an objective conversation about the traffic in the Squirrel Hill Tunnels while sitting in stop-and-go traffic on the Parkway East. Similarly, the magnitude of your satisfaction or frustration of coding may not be apparent while looking at your IDE. The act of separating ourselves from the keyboard and the facilitated prompts helps the engineer to think about the code objectively.

If you're frustrated about how hard it is to develop, maintain or enhance your code you might think about it during your commute or while you're at home. It would be much better to discuss this as a team, so the other engineers understand your position and can potentially help. Doing it as a team encourages discussion and helps to establish understanding and consensus.

---

## Who

All of the engineers on the product team should participate. The team should decide, in advance, what to do if someone is not able to attend and what represents a quorum. Effort should be made to keep a regular cadence — if a meeting cannot be held because of an absence, consider rescheduling the session as soon as possible to keep close to the schedule.

The session is led by a facilitator who guides the team through the discussion. The facilitator is another engineer, preferably in a senior role so they can understand the technical topics which might be discussed and possess a broad set of experiences to draw on. They need to be from another team so that all of the engineers on the team can fully participate in the session.

The ritual should feel like a conversation amongst equals, so avoid having engineering managers as facilitators, especially when that manager is in the team's reporting structure. The facilitator must be empathetic and someone who can listen without interjecting their own opinions. The facilitator is responsible for helping the team identify and discuss possible issues; they are not responsible for solving problems. If a significant conflict is raised, the team needs to work with its engineering manager to resolve those issues.

> **Note:** The use of the term "senior engineer" for the facilitator is more about experience than title. The ability and desire to listen is more important than what it says on your email footer.

---

## When

The should start with a cadence of meeting every two weeks. You may find that meeting more or less frequently as fits their needs. The team could also choose to change the frequency as the tempo of your effort changes. As your effort intensifies, consider holding the conversation more often. This may help you recognize the impact of external pressures on your engineering practices.

---

## How Long

The intent is to keep the ceremony brief. Shoot for 30 minutes to start. Once the team becomes more proficient, the ceremony should take less time. This is time to discuss the state of the engineering team. It is not a time for bikeshedding. Be mindful of the fact that the engineers in this conversation are not writing code. This conversation is about identifying problems, not solving them.

---

## Where

The focus of the conversation is a set of questions, or prompts, and the team's voting tracked over time, captured in a spreadsheet. It is best if the team can see this spreadsheet during the conversation, so a conference room with some type of video display is best.

---

## How

The facilitator will walk the team through each prompt in the spreadsheet and the type of vote. For each prompt, the participants will use a four finger vote or roman vote, depending on the topic. Each participant should take a few seconds to consider the topic then extends a closed fist to indicate that they are ready to vote. Once everyone is ready, the facilitator counts for everyone to cast their vote — something like "1-2-3-shoot". The participants will all display their vote.

The finger vote is 1–4 so there is no middle ground. Each answer must be "more good than bad" or "more bad than good". The roman votes are almost always thumbs up or down; only one topic allows for a "sideways" thumb vote.

The facilitator captures the results in the spreadsheet, taking an average of the finger votes or a tally of the roman votes. The facilitator will take note of any outliers in the vote and then prompt those engineers to briefly describe their position. The rest of the team should listen and, if appropriate, ask clarifying questions. There should not be any "Yes, but here's why you're wrong..." type responses.

Issues may be identified during these sessions, but the team shouldn't try to resolve them at this time. To keep the conversation brief, if a possible issue is identified then a senior engineer on the team should take it as an action item to address at a later time.

---

## Topics

This table documents the set of topics to discuss during the health check. It's just a starting point. Each team should review the list, decide which topics are important to them, and make sure they all agree on what each topic means to them.

### Developing and Changing Code

| Topic                                                        | Voting             | Prompts                                                                                                                               |
|--------------------------------------------------------------|--------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| How easy is it to add features to production code?           | Finger votes (1–4) | Do you know where to find the code for a feature? / Do you think changing existing code is hard?                                      |
| How easy is it to reason about production code?              | Finger votes (1–4) | Do you understand the functionality? / Do you know which pieces interoperate and how? / Do you understand the libraries used and how? |
| How would you rate the code under active development?        | Finger votes (1–4) | Do you feel rushed? / Are you making the code better?                                                                                 |
| How would you rate the code for the entirety of the project? | Finger votes (1–4) | Are you happy with the code? / Are there things you want to clean up?                                                                 |

### Automated Development Tests

| Topic                                                                           | Voting               | Prompts                                                                                                                                                                                        |
|---------------------------------------------------------------------------------|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Is the test suite effective?                                                    | Finger votes (1–4)   | Do the tests communicate where to go to fix issues? / Is the team able to refactor code without a large change to the test code? / Do the tests convey the behavior of the system as accepted? |
| Is the test suite consistent?                                                   | Roman Vote (Up/Down) | Are the test results flaky? / Fail where there are no code changes? / Dependent on the state of the environment? / Dependent on data in other systems?                                         |
| How would you rate the tests you are writing for code under active development? | Finger votes (1–4)   | Are they complete? / Are you making the tests better? / Do they communicate the behavior of the code?                                                                                          |
| How would you rate the tests for the entirety of the project?                   | Finger votes (1–4)   | Are there known gaps in the tests? / Are the tests helpful or a hindrance?                                                                                                                     |
| Test Suite Time                                                                 | (recorded, no vote)  | How long does it take to run your tests? Test times should be summed across all applications. This can be tedious to collect and may not be necessary.                                         |

### Others

| Topic                                          | Voting               | Prompts                                                                                   |
|------------------------------------------------|----------------------|-------------------------------------------------------------------------------------------|
| Confidence in the pipeline                     | Finger votes (1–4)   | Are builds consistent? / Are deployments reliable?                                        |
| Are you comfortable with the technology stack? | Roman Vote (Up/Down) | Language(s) / Libraries / frameworks / External services / Pipeline / Platform            |
| How effective is pairing?                      | Finger votes (1–4)   | Time spent pairing / Balanced collaboration while pairing / Pair composition and rotation |

### Overall

| Topic         | Voting                        | Prompts                                                                                                                |
|---------------|-------------------------------|------------------------------------------------------------------------------------------------------------------------|
| Project Trend | Roman Vote (Up/Sideways/Down) | General mood of development / Going Up, Steady, Going Down / Are you making progress? / Moving forward or bogged down? |

---

## Additional Notes

- The set of topics can be added, removed or tweaked to better benefit the team. 
- Consider tracking action items across sessions to make sure they are carried out, discuss if they are effective, and having a positive impact on the engineers.
- Make your first session an hour long to familiarize yourselves with the topics and process.
- If possible, use a room which is appropriate to the size of the team; it should be cozy not cavernous. A large room would give the participants the space to spread out and make it easier for defensive posturing.

---

## Frequently Asked Questions

**Q: Does this apply to all your code, legacy and green field?**

A: It's up to each team to consider and decide. Some teams which have adopted the practice decided to restrict to greenfield code. It may depend on the amount of time you spend working in legacy code.

**Q: Who can facilitate these sessions?**

A: Any senior engineer could facilitate, so long as they are able to actively listen and make sure that all members in the group have the opportunity to be heard. It is probably best if they have been through the process a few times themselves. 

**Q: Does the same person always need to facilitate for your team?**

A: No. Anyone who is willing to facilitate for you should be able to do it.
