# ASCURE BLUEPRINT V5

# API, Services & Business Logic Specification

Version: 1.0

Purpose:

Define all backend behavior required to reconstruct ASCURE.

This document focuses on:

- API design
- Service responsibilities
- Business rules
- Validation
- Permission enforcement
- Workflow processing

This is a logical specification, not source code.

------------------------------------------------------------------------

# 1. API Architecture

Backend Framework:

NestJS

Architecture Style:

REST API

Authentication:

JWT

Authorization:

Role-Based + Operational Access

------------------------------------------------------------------------

Base URL

/api/v1

------------------------------------------------------------------------

# 2. Authentication Module

Purpose:

Authenticate users.

------------------------------------------------------------------------

POST /auth/login

Input

email

password

------------------------------------------------------------------------

Response

accessToken

refreshToken

userProfile

permissions

accessibleMainheads

------------------------------------------------------------------------

Validation

User active

Password valid

Organization active

------------------------------------------------------------------------

POST /auth/refresh

Purpose:

Issue new JWT.

------------------------------------------------------------------------

POST /auth/logout

Purpose:

Invalidate session.

------------------------------------------------------------------------

# 3. User Service

Purpose:

Manage users.

------------------------------------------------------------------------

GET /users

ADMIN only

------------------------------------------------------------------------

GET /users/:id

ADMIN

Manager

Self

------------------------------------------------------------------------

POST /users

Create user.

------------------------------------------------------------------------

PATCH /users/:id

Update user.

------------------------------------------------------------------------

DELETE /users/:id

Soft delete only.

Never hard delete.

------------------------------------------------------------------------

# 4. MAINHEAD Visibility Resolver

Purpose:

Determine visible MAINHEADs.

Critical Governance G1 service.

------------------------------------------------------------------------

GET /users/me/mainheads

Resolution Order

1.  Direct MAINHEAD access

UserMainheadAccess

2.  Operational Region access

UserOperationalRegionAccess

3.  Team fallback

4.  Branch fallback

5.  Legacy user.mainheadId

6.  ADMIN override

7.  ASCURA QA override

------------------------------------------------------------------------

Response

List of accessible MAINHEADs.

------------------------------------------------------------------------

# 5. Operational Region Service

Purpose:

Governance G1.

------------------------------------------------------------------------

GET /operational-regions

POST /operational-regions

PATCH /operational-regions/:id

DELETE /operational-regions/:id

------------------------------------------------------------------------

Rules

Soft delete only.

------------------------------------------------------------------------

# 6. MAINHEAD Service

Purpose:

Manage operational areas.

------------------------------------------------------------------------

GET /mainheads

Supports filtering by:

Region

Status

Search

------------------------------------------------------------------------

POST /mainheads

PATCH /mainheads/:id

DELETE /mainheads/:id

------------------------------------------------------------------------

# 7. Organization Service

Purpose:

Manage companies.

------------------------------------------------------------------------

Supported Types

Governance

Utility

Inspection Contractor

Maintenance Contractor

------------------------------------------------------------------------

# 8. Team Service

Purpose:

Manage operational teams.

------------------------------------------------------------------------

Functions

Create Team

Update Team

Assign Users

Remove Users

Assign Capabilities

------------------------------------------------------------------------

# 9. Project Service

Purpose:

Contract container.

------------------------------------------------------------------------

Relationships

Project

→ Work Package

→ Site Visit

------------------------------------------------------------------------

# 10. Site Visit Service

Purpose:

Operational field execution.

------------------------------------------------------------------------

Create Visit

Update Visit

Cancel Visit

Complete Visit

------------------------------------------------------------------------

Validation

MAINHEAD required

Project optional

Work Package optional

------------------------------------------------------------------------

# 11. Site Visit Completion Rules

Site Visit may complete only when:

Asset count \> 0

All inspections synced

No pending submissions

------------------------------------------------------------------------

Otherwise:

Completion blocked.

------------------------------------------------------------------------

# 12. Asset Service

Purpose:

Manage inspected assets.

------------------------------------------------------------------------

POST /assets

Create asset.

------------------------------------------------------------------------

Validation

Asset code uniqueness:

tenantId

substationId

assetCode

------------------------------------------------------------------------

Operational Status

EXISTING

NEW

NOT_FOUND

DEMOLISHED

------------------------------------------------------------------------

# 13. Inspection Template Service

Purpose:

Dynamic forms.

------------------------------------------------------------------------

Create Template

Version Template

Clone Template

Archive Template

Activate Template

------------------------------------------------------------------------

# 14. Template Resolution Engine

Critical governance component.

------------------------------------------------------------------------

Input

Asset Type

MAINHEAD

Region

Branch

Organization

------------------------------------------------------------------------

Resolution Order

MAINHEAD

↓

OPERATIONAL_REGION

↓

BRANCH

↓

ORGANIZATION

↓

GLOBAL

------------------------------------------------------------------------

First ACTIVE match wins.

------------------------------------------------------------------------

# 15. Checklist Builder V2

Supported Types

TEXT

NUMBER

YES_NO

DROPDOWN

MULTI_SELECT

IMAGE

GPS

DATE

DATETIME

READING

OCR

------------------------------------------------------------------------

Supports

Required

showIf

Display Order

Image Rules

Configuration

------------------------------------------------------------------------

# 16. Inspection Service

Purpose:

Store completed inspections.

------------------------------------------------------------------------

Save Draft

Submit

Approve

Reject

------------------------------------------------------------------------

Statuses

DRAFT

SUBMITTED

APPROVED

REJECTED

------------------------------------------------------------------------

# 17. Inspection Submission Logic

When submitted:

Validate checklist

Validate required fields

Validate images

Persist responses

Generate defects

Generate timeline

Queue photos

------------------------------------------------------------------------

Result

SUBMITTED

------------------------------------------------------------------------

# 18. Defect Generation Engine

Purpose:

Automatically create defects.

------------------------------------------------------------------------

Triggers

Template-defined defect conditions.

Example

Broken Insulator = YES

↓

Generate Defect

------------------------------------------------------------------------

Defects linked to:

Inspection

Asset

Site Visit

------------------------------------------------------------------------

# 19. Defect Service

Purpose:

Lifecycle management.

------------------------------------------------------------------------

Create

Verify

Reject

Assign

Start

Complete

Close

------------------------------------------------------------------------

# 20. Defect Lifecycle Enforcement

Valid Path

DETECTED

↓

UNDER_REVIEW

↓

VERIFIED

↓

ASSIGNED

↓

IN_PROGRESS

↓

COMPLETED

↓

VERIFICATION_PENDING

↓

CLOSED

------------------------------------------------------------------------

Invalid transitions blocked.

------------------------------------------------------------------------

# 21. Verification Rules

Only QA users may:

Verify defect

Reject defect

Close defect

------------------------------------------------------------------------

Inspection contractors cannot close defects.

------------------------------------------------------------------------

# 22. Assignment Rules

Defect must be:

VERIFIED

before assignment.

------------------------------------------------------------------------

Otherwise:

Assignment blocked.

------------------------------------------------------------------------

# 23. Maintenance Service

Purpose:

Execute repair work.

------------------------------------------------------------------------

Actions

Start Work

Upload Evidence

Mark Completed

------------------------------------------------------------------------

Evidence

Multiple images

Timestamped

GPS supported

------------------------------------------------------------------------

# 24. Completion Shortcut

Operational improvement.

------------------------------------------------------------------------

Mark Completed from VERIFIED

System internally advances:

VERIFIED

↓

ASSIGNED

↓

IN_PROGRESS

↓

COMPLETED

------------------------------------------------------------------------

Maintains lifecycle integrity.

------------------------------------------------------------------------

# 25. Closure Verification

Purpose:

QA approval of maintenance.

------------------------------------------------------------------------

Required before:

CLOSED

------------------------------------------------------------------------

Actions

Approve Closure

Reject Closure

Request Rework

------------------------------------------------------------------------

# 26. Timeline Service

Purpose:

Operational history.

------------------------------------------------------------------------

Events

STATUS_CHANGED

DEFECT_VERIFIED

DEFECT_REJECTED

DEFECT_ASSIGNED

MAINTENANCE_STARTED

MAINTENANCE_COMPLETED

CLOSURE_VERIFIED

------------------------------------------------------------------------

Generated automatically.

------------------------------------------------------------------------

# 27. Audit Service

Purpose:

Governance.

------------------------------------------------------------------------

Capture

User

Action

Old Value

New Value

Timestamp

------------------------------------------------------------------------

Required For

Configuration changes

Defect changes

Inspection approval

Assignment

Closure

------------------------------------------------------------------------

# 28. Capability Service

Purpose:

Operational permissions.

------------------------------------------------------------------------

Assignable To

Organization

Branch

MAINHEAD

Team

User

------------------------------------------------------------------------

Supports future workflow restrictions.

------------------------------------------------------------------------

# 29. Mobile Sync Service

Purpose:

Offline-first operation.

------------------------------------------------------------------------

Queue Types

Inspection

Photo

Visit Completion

Maintenance

------------------------------------------------------------------------

Sync Order

Inspection

↓

Photos

↓

Defects

↓

Visit Completion

------------------------------------------------------------------------

# 30. Photo Upload Service

Purpose:

Evidence storage.

------------------------------------------------------------------------

Supports

Multiple Images

Timestamp Overlay

GPS Overlay

Retry Upload

------------------------------------------------------------------------

Future

Object Storage

Cloudflare R2

AWS S3

MinIO

------------------------------------------------------------------------

# 31. Reporting Service

Current

Excel Export

Per Pencawang

Per Site Visit

------------------------------------------------------------------------

Future

PDF Reports

Visual Reports

Dashboards

Heatmaps

------------------------------------------------------------------------

# 32. Operations Board Service

Purpose:

Executive operational view.

------------------------------------------------------------------------

Displays

Visits

Assets

Inspections

Defects

Maintenance

------------------------------------------------------------------------

Filters

MAINHEAD

Region

Organization

Status

Date

------------------------------------------------------------------------

# 33. Security Rules

ADMIN

Full Access

------------------------------------------------------------------------

QA

Cross-region visibility

Cross-mainhead visibility

Verification authority

Closure authority

------------------------------------------------------------------------

Manager

Assignment authority

Team visibility

Reporting access

------------------------------------------------------------------------

Technician

Operational execution only

No governance actions

------------------------------------------------------------------------

# 34. Error Handling Principles

Never expose stack traces.

------------------------------------------------------------------------

Operational errors must return:

Clear message

Actionable guidance

------------------------------------------------------------------------

Example

"Inspection cannot be submitted because required images are missing."

------------------------------------------------------------------------

# 35. Future Services

Notification Engine

Push Notifications

Email Notifications

------------------------------------------------------------------------

AI Validation Engine

Image Analysis

Checklist Validation

Duplicate Detection

------------------------------------------------------------------------

Analytics Engine

Operational KPIs

Performance Metrics

SLA Monitoring

------------------------------------------------------------------------

END OF ASCURE BLUEPRINT V5
