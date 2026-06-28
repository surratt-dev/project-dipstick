# Voting Mechanics

## Overview

This document describes the voting mechanics used during Engineering Health Check sessions. The voting system is designed to gather honest, nuanced feedback from team members while preventing neutral default responses.

---

## Vote Types

### Finger Voting

**When to use**: When there is a possible range of opinions on a topic.

**How it works**: Each participant holds up 1, 2, 3, or 4 fingers to communicate their response.

**Scale**:
- **1 (1 finger)**: Bad — The topic represents a significant problem or source of frustration
- **2 (2 fingers)**: Somewhat bad — There are notable issues that need attention
- **3 (3 fingers)**: Somewhat good — Things are acceptable but there's room for improvement
- **4 (4 fingers)**: Good — The topic is in a satisfactory state

**Why no middle ground**: An even number is used to prevent an easy default to a neutral/middle answer. The goal is to develop an honest model of the engineering team's sentiment, so we don't want to allow cop-outs. Participants must commit to either the positive or negative side of the scale.

**Narrative interpretation**: Rather than thinking in strict numbers, participants should ask themselves: "Is this topic more good than bad, or more bad than good?" The closer to "good" your experience, the higher the number; the closer to "bad," the lower the number.

---

### Roman Vote

**When to use**: When evaluating a binary condition — something is either working or it isn't, either present or absent.

**How it works**: A simple thumbs up or thumbs down vote.

**Scale**:
- **Thumbs up**: Good — The condition is met, working as expected, no significant issues
- **Thumbs down**: Bad — The condition is not met, there are problems that need attention

**When to use this type**:
- Test suite consistency (flaky tests?)
- Technology stack comfort (happy with tools?)
- Any yes/no type question

---

### Modified Roman Vote

**When to use**: Specifically for trend questions where direction matters more than absolute state.

**How it works**: Three-position vote allowing for a neutral/sideways option.

**Scale**:
- **Thumbs up**: The trend is positive — things are improving, moving in the right direction
- **Flat hand (palm down)**: The trend is steady — things are stable, no significant change
- **Thumbs down**: The trend is negative — things are declining, getting worse

**Alternative display**: A closed fist held horizontally (sideways) is also acceptable for the neutral position.

**Example use case**: "Project Trend" — asking whether the overall state of development is improving, holding steady, or declining.

---

## Voting Process

### Step-by-Step

1. **Facilitator states the prompt**: The question or topic being voted on
2. **Facilitator announces the vote type**: Finger, Roman, or Modified Roman
3. **Facilitator explains the meaning**: Briefly restates what "good" and "bad" mean for this specific question
4. **Participants prepare**: Each participant takes a few seconds to privately consider the topic
5. **Ready signal**: Participants show a closed fist to indicate they're ready to vote
6. **Countdown**: The facilitator counts down — "3... 2... 1... vote"
7. **Participants display**: All participants simultaneously show their vote
8. **Facilitator records**: Results are captured in the tracking spreadsheet

---

## Discussion Rules

### Outlier Identification

After voting, the facilitator identifies any outliers — votes that are significantly different from the group consensus. Outliers are typically defined as:

- For finger votes: 2 or more points away from the average
- Any vote that is dramatically different from the group

### Outlier Discussion Protocol

1. **Request clarification, not debate**: The facilitator asks the outlier voter to briefly describe their perspective
2. **Listen without defending**: Other team members listen and may ask clarifying questions
3. **No "Yes, but..." responses**: The purpose is to understand, not to argue or convince
4. **Document, don't solve**: Note the perspective for future reference; don't attempt to resolve issues during the session
5. **Move on promptly**: Keep discussion brief to maintain the 30-minute timebox

### Action Item Assignment

If discussion reveals an issue that needs follow-up:

- A senior engineer on the team volunteers to own the action item
- The item is recorded in the session notes
- It is reviewed in the next session to track progress

---

## Tips for Facilitators

- **Keep the countdown steady**: A rushed or irregular countdown can bias results
- **Ensure everyone votes simultaneously**: Looking at others' votes before showing your own undermines honesty
- **Watch for anchoring**: Be aware if early voters are influencing later voters
- **Record exactly what you see**: Don't interpret or normalize votes when recording
- **Stay neutral**: Your role is to facilitate, not to influence or judge the results
