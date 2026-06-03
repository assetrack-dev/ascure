# ASCURE BLUEPRINT V3

# Screen Specification & User Experience Design

Version: 1.0

------------------------------------------------------------------------

# 1. Mobile Application

## Purpose

The mobile application is the primary operational tool used by field
personnel.

Primary users:

- Technician
- Team Leader
- Inspector
- Maintenance Technician

The mobile application must remain:

- Offline-first
- Fast
- Simple
- Operationally focused

------------------------------------------------------------------------

# 2. Login Screen

## Purpose

Authenticate user.

------------------------------------------------------------------------

## Fields

Email

Password

------------------------------------------------------------------------

## Actions

Login

------------------------------------------------------------------------

## Validation

Email required

Password required

------------------------------------------------------------------------

## Behavior

Successful login:

Download profile

Download permissions

Download accessible MAINHEADs

Download active templates

------------------------------------------------------------------------

## Security

JWT authentication.

Credentials not auto-filled.

------------------------------------------------------------------------

# 3. Workspace Selection

## Purpose

Select operational workspace.

------------------------------------------------------------------------

## Available Workspaces

Inspection

Maintenance

------------------------------------------------------------------------

## Rules

Single workspace user:

Auto-open workspace.

Multi-workspace user:

Show selection screen.

------------------------------------------------------------------------

# 4. Inspection Workspace

## Purpose

Entry point for inspections.

------------------------------------------------------------------------

## Sections

In Progress

Completed

Need Amendment

------------------------------------------------------------------------

## Hidden

Approved

------------------------------------------------------------------------

## Filters

MAINHEAD

Status

Search

------------------------------------------------------------------------

## Actions

Open Site Visit

Create Site Visit

Refresh

------------------------------------------------------------------------

# 5. Site Visit List

## Purpose

Display assigned operational visits.

------------------------------------------------------------------------

## Fields

Visit Number

MAINHEAD

Pencawang

Status

Created Date

------------------------------------------------------------------------

## Actions

Open Visit

Search

Filter

------------------------------------------------------------------------

# 6. Site Visit Detail

## Purpose

Operational container for inspections.

------------------------------------------------------------------------

## Displays

Visit Information

Assets

Progress

Defects Found

Completion Percentage

------------------------------------------------------------------------

## Actions

Check In

Add Asset

Open Asset

Complete Visit

Cancel Visit

------------------------------------------------------------------------

## Completion Rules

Must contain assets.

No pending inspections.

No active sync failures.

------------------------------------------------------------------------

# 7. Check-In Screen

## Purpose

Record operational attendance.

------------------------------------------------------------------------

## Captures

GPS

Timestamp

User

Site Visit

------------------------------------------------------------------------

## Evidence

Automatic.

No manual editing.

------------------------------------------------------------------------

# 8. Add Asset Screen

## Purpose

Create asset during inspection.

------------------------------------------------------------------------

## SAVR Fields

NO TIANG RONDAAN

NO TIANG LAMA

Latitude

Longitude

Asset Status

Remarks

------------------------------------------------------------------------

## Asset Status

Existing

New

Not Found

Demolished

------------------------------------------------------------------------

## Actions

Save Asset

Use Current GPS

Map Picker

------------------------------------------------------------------------

## Success Behavior

Navigate directly to Asset Detail.

------------------------------------------------------------------------

# 9. Asset Detail Screen

## Purpose

Operational hub for asset.

------------------------------------------------------------------------

## Displays

Asset Information

Inspection Status

Defect Count

Photos

GPS

------------------------------------------------------------------------

## Actions

Start Inspection

Edit Asset

View Defects

------------------------------------------------------------------------

# 10. Inspection Form

## Purpose

Execute inspection template.

------------------------------------------------------------------------

## Data Source

Dynamic Checklist Builder.

No hardcoded forms.

------------------------------------------------------------------------

## Supported Field Types

Text

Number

Yes/No

Dropdown

Multi Select

Image

GPS

Date

DateTime

Reading

OCR Placeholder

------------------------------------------------------------------------

## Features

Required validation

showIf logic

Image requirements

Auto-save

Offline save

------------------------------------------------------------------------

## Actions

Save Draft

Submit Inspection

------------------------------------------------------------------------

# 11. Inspection Submission

## Process

Validate checklist

Generate defects

Queue photos

Queue submission

Store offline if needed

------------------------------------------------------------------------

## Result

Inspection status:

SUBMITTED

------------------------------------------------------------------------

# 12. Defect Detail Screen

## Purpose

Display defect information.

------------------------------------------------------------------------

## Displays

Defect Description

Severity

Evidence Images

Timeline

Status

------------------------------------------------------------------------

## Actions

View Evidence

View Timeline

------------------------------------------------------------------------

# 13. Maintenance Workspace

## Purpose

Entry point for maintenance activities.

------------------------------------------------------------------------

## Sections

Assigned

In Progress

Completed

Verification Pending

------------------------------------------------------------------------

# 14. Maintenance Defect Detail

## Purpose

Perform maintenance work.

------------------------------------------------------------------------

## Displays

Defect

Asset

Location

Evidence

Instructions

------------------------------------------------------------------------

## Actions

Start Work

Upload Evidence

Mark Completed

------------------------------------------------------------------------

# 15. Maintenance Evidence

## Purpose

Provide proof of rectification.

------------------------------------------------------------------------

## Supports

Multiple Images

Timestamp Overlay

GPS Overlay

Notes

Completion Remarks

------------------------------------------------------------------------

## Rules

At least one image recommended.

All evidence timestamped.

------------------------------------------------------------------------

# 16. Sync Queue Screen

## Purpose

Operational visibility into offline data.

------------------------------------------------------------------------

## Displays

Queued Inspections

Queued Photos

Queued Visits

Queued Maintenance Actions

------------------------------------------------------------------------

## Statistics

Pending

Completed

Failed

Syncing

------------------------------------------------------------------------

## Actions

Retry Sync

Refresh

Clear Completed

------------------------------------------------------------------------

# 17. Settings Screen

## Displays

User

Organization

Version

Environment

API Endpoint

------------------------------------------------------------------------

## Actions

Logout

Refresh Configuration

------------------------------------------------------------------------

# 18. Admin Web

Purpose:

Governance and operational management.

------------------------------------------------------------------------

# 19. Dashboard

Displays:

Active Visits

Pending Inspections

Verified Defects

Maintenance Progress

Closure Status

------------------------------------------------------------------------

# 20. Users Module

## Purpose

Manage users.

------------------------------------------------------------------------

## Fields

Name

Email

Role

Organization

Branch

Team

------------------------------------------------------------------------

## Access Configuration

Direct MAINHEAD Access

Operational Region Access

Capabilities

------------------------------------------------------------------------

## Actions

Create

Edit

Deactivate

Reset Password

------------------------------------------------------------------------

# 21. Organizations Module

Manage companies.

Types:

Governance

Utility

Inspection Contractor

Maintenance Contractor

------------------------------------------------------------------------

# 22. Branch Module

Manage operational branches.

------------------------------------------------------------------------

# 23. Operational Regions Module

Governance G1.

------------------------------------------------------------------------

## Actions

Create

Edit

Deactivate

------------------------------------------------------------------------

# 24. MAINHEAD Module

Represents operational areas.

------------------------------------------------------------------------

## Fields

Name

Code

Operational Region

Status

------------------------------------------------------------------------

# 25. Teams Module

Represents operational execution teams.

------------------------------------------------------------------------

## Actions

Create Team

Assign Users

Assign Capabilities

------------------------------------------------------------------------

# 26. Projects Module

Represents contract/project container.

------------------------------------------------------------------------

# 27. Work Packages Module

Represents operational scope within project.

------------------------------------------------------------------------

# 28. Site Visit Administration

Displays:

Visits

Progress

Assets

Inspection Status

Defects

------------------------------------------------------------------------

## Actions

View

Edit

Close

Cancel

------------------------------------------------------------------------

# 29. Asset Administration

Displays

Asset Information

History

Inspections

Defects

GPS

------------------------------------------------------------------------

# 30. Template Builder

One of the most critical modules.

------------------------------------------------------------------------

## Capabilities

Create Template

Clone Template

Version Template

Archive Template

Activate Template

------------------------------------------------------------------------

## Supported Types

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

## Conditional Logic

showIf

------------------------------------------------------------------------

# 31. Template Scope Assignment

Assign template to:

GLOBAL

ORGANIZATION

BRANCH

OPERATIONAL_REGION

MAINHEAD

------------------------------------------------------------------------

# 32. Defect Board

Primary operational management screen.

------------------------------------------------------------------------

## Queues

Detected

Under Review

Verified

Assigned

In Progress

Completed

Verification Pending

Closed

------------------------------------------------------------------------

## Actions

Verify

Reject

Assign

Start

Complete

Close

------------------------------------------------------------------------

# 33. Operations Board

Executive operational view.

------------------------------------------------------------------------

## Filters

MAINHEAD

Region

Organization

Status

Date

------------------------------------------------------------------------

## Displays

Visit Progress

Inspection Progress

Defect Progress

Maintenance Progress

------------------------------------------------------------------------

# 34. Permission Principles

ADMIN

Full Access

------------------------------------------------------------------------

QA

Cross-region visibility

Cross-mainhead visibility

Verification authority

Closure authority

------------------------------------------------------------------------

Technician

Operational access only

No governance actions

------------------------------------------------------------------------

Manager

Team management

Assignment authority

Operational reporting

------------------------------------------------------------------------

# 35. UI Design Philosophy

Operational first.

Not corporate first.

------------------------------------------------------------------------

Rules:

Reduce text.

Reduce clicks.

Large action buttons.

Minimal scrolling.

High visibility status indicators.

Offline awareness always visible.

Evidence always accessible.

------------------------------------------------------------------------

END OF ASCURE BLUEPRINT V3
