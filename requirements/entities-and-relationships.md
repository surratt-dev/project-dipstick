# Entities and Relationships

## Entities

### People / Roles
- Engineer
- Senior Engineer
- Facilitator
- Engineering Manager

### Groups
- Engineering Team
- Product Team

### Process
- Engineering Health Check
- Session
- Retrospective
- Action Item
- Quorum
- Trend
- Outlier
- Discussion

### Artifacts
- Spreadsheet
- Topic
- Prompt
- Vote

### Vote Types
- Finger Vote
- Roman Vote
- Modified Roman Vote

### Topic Areas
- Production Code
- Test Suite
- Pipeline
- Technology Stack
- Pairing

---

## Relationships

| Entity A | Relationship | Entity B |
|---|---|---|
| Facilitator | leads | Session |
| Facilitator | is a member of | Engineering Team (different team) |
| Facilitator | is a | Senior Engineer |
| Facilitator | captures results in | Spreadsheet |
| Facilitator | identifies | Outlier |
| Facilitator | prompts | Discussion |
| Engineering Team | participates in | Session |
| Engineering Team | is part of | Product Team |
| Engineering Manager | resolves conflicts raised in | Session |
| Senior Engineer | owns | Action Item |
| Session | contains | Topic |
| Session | produces | Action Item |
| Session | is an instance of | Engineering Health Check |
| Topic | uses | Vote |
| Topic | is accompanied by | Prompt |
| Finger Vote | is a type of | Vote |
| Roman Vote | is a type of | Vote |
| Modified Roman Vote | is a type of | Vote |
| Spreadsheet | tracks | Trend |
| Outlier | triggers | Discussion |
| Discussion | may produce | Action Item |
| Engineering Health Check | covers | Production Code |
| Engineering Health Check | covers | Test Suite |
| Engineering Health Check | covers | Pipeline |
| Engineering Health Check | covers | Technology Stack |
| Engineering Health Check | covers | Pairing |
