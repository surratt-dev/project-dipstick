# Engineering Health Check Web App - Questions

## Questions Requiring Answers

### Question 1: Session Format

How will sessions primarily be conducted?

- **In-person in a room** (web app used only for recording/trending)
- **Fully remote** (participants join from different locations) **[ANSWERED: YES - this is the focus]**
- **Hybrid** (some in-room, some remote participants)
- **Asynchronous** (participants vote on their own time, not in real-time)

Voice and video are OUT of scope. This app only handles voting.

### Question 2: Team Structure

Will the application support:
- Single team usage
- Multiple teams within an organization **[ANSWERED: YES - multiple teams in single tenant]**
- Cross-team visibility (managers viewing team health)
- No, it's just for a single team's private use

**Access model**: Team metrics visible to team members, their engineering manager, and the current facilitator.

### Question 3: Historical Data

Do you have existing historical data to import?
- Yes, we have spreadsheets with past sessions
- No, starting fresh **[ANSWERED]**
- Maybe, need to assess

### Question 4: Authentication/Access

What authentication model do you envision?
- Simple shareable links (no auth)
- Email-based sign-in
- Corporate SSO integration **[ANSWERED: Microsoft Entra initially, with abstraction for other providers]**
- Open to recommendations

### Question 5: Mobile Support

How important is mobile/tablet support for participants?
- Critical (engineers might be on call, traveling)
- Nice to have but not priority **[ANSWERED: Desktop priority, mobile not a priority]**
- Not needed (always on laptop)

### Question 6: Required Features

**Must-haves (all of these)**:
- [x] Real-time voting during sessions
- [x] Trend charts over time
- [x] Topic customization per team
- [x] Session note-taking
- [x] Action item tracking

**Nice-to-haves (NOT in scope)**:
- [ ] Export to various formats
- [ ] Integration with other tools (Slack, Jira)
- [ ] Sentiment analysis of discussion notes
- [ ] Recommendations engine for improvements
- [ ] Anonymity **[EXPLICITLY REJECTED - trust building is the intent]**
