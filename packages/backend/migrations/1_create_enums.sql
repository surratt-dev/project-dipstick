-- Migration 1: Create PostgreSQL enum types
-- All enum types are defined before any table that references them.

-- Up
CREATE TYPE user_role AS ENUM (
    'engineer',
    'senior_engineer',
    'facilitator',
    'engineering_manager',
    'application_admin'
);

CREATE TYPE vote_type AS ENUM (
    'finger',
    'roman',
    'modified_roman'
);

CREATE TYPE session_status AS ENUM (
    'lobby',
    'pre_session',
    'active',
    'wrap_up',
    'complete',
    'abandoned'
);

CREATE TYPE action_item_status AS ENUM (
    'open',
    'in_progress',
    'resolved'
);

CREATE TYPE topic_status AS ENUM (
    'active',
    'archived'
);

CREATE TYPE session_topic_status AS ENUM (
    'waiting',
    'voting',
    'revealed',
    'complete'
);

CREATE TYPE membership_role AS ENUM (
    'participant',
    'engineering_manager'
);
