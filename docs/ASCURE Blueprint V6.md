# ASCURE BLUEPRINT V6

# Operational Governance & Rulebook

Version: 1.0

Purpose:

This document defines the operational governance model of ASCURE.

It describes:

- Authority
- Responsibility
- Visibility
- Workflow ownership
- Operational truth
- Decision-making rules

This document takes precedence over implementation details.

If code and governance conflict, governance should be considered the
intended behavior.

------------------------------------------------------------------------

# 1. Governance Philosophy

ASCURE is not a data collection application.

ASCURE is an operational governance platform.

The primary objective is:

Preserve operational truth from inspection through closure.

------------------------------------------------------------------------

# 2. Operational Truth Principle

There must only be one accepted operational truth.

Examples:

An asset exists or does not exist.

A defect is verified or not verified.

A repair is completed or not completed.

A closure is approved or not approved.

------------------------------------------------------------------------

Conflicting operational states are not permitted.

------------------------------------------------------------------------

# 3. Separation of Duties

Inspection and verification should be separated.

Repair and closure should be separated.

Operational execution and governance should be separated.

------------------------------------------------------------------------

Reason:

Reduce bias.

Improve accountability.

Improve auditability.

------------------------------------------------------------------------

# 4. ASCURA Governance Role

ASCURA owns governance.

ASCURA does not perform utility ownership functions.

ASCURA does not act as contractor management.

ASCURA acts as:

QA/QC

Operational verification

Audit

Governance

------------------------------------------------------------------------

# 5. Utility Owner Role

Example:

TNB

Responsibilities:

Issue work

Monitor progress

Receive reports

Review operational performance

------------------------------------------------------------------------

Utility owner does not necessarily perform QA.

------------------------------------------------------------------------

# 6. Inspection Contractor Role

Responsibilities:

Field inspection

Asset registration

Checklist completion

Defect identification

Evidence collection

------------------------------------------------------------------------

Inspection contractor cannot:

Close defects

Approve closure

Override QA decisions

------------------------------------------------------------------------

# 7. Maintenance Contractor Role

Responsibilities:

Repair defects

Upload evidence

Complete work

Provide completion notes

------------------------------------------------------------------------

Maintenance contractor cannot:

Verify defects

Approve closure

Override QA decisions

------------------------------------------------------------------------

# 8. QA/QC Role

QA belongs to ASCURA.

------------------------------------------------------------------------

Responsibilities

Review inspections

Approve inspections

Reject inspections

Verify defects

Approve maintenance closure

Audit records

------------------------------------------------------------------------

Authority

Cross-region

Cross-MAINHEAD

Cross-project

Cross-contractor

------------------------------------------------------------------------

# 9. MAINHEAD Governance

MAINHEAD represents operational area.

------------------------------------------------------------------------

Examples

KL Timur

KL Barat

Langat

Subang

Klang

------------------------------------------------------------------------

MAINHEAD exists for:

Operational management

Reporting

Template customization

Access control

------------------------------------------------------------------------

# 10. Operational Region Governance

Operational Region groups MAINHEADs.

------------------------------------------------------------------------

Examples

Klang Valley

Pahang

Johor

------------------------------------------------------------------------

Purpose

Governance layer above MAINHEAD.

------------------------------------------------------------------------

# 11. Multi-MAINHEAD Principle

Users may access:

One MAINHEAD

Multiple MAINHEADs

Entire Region

------------------------------------------------------------------------

Reason

Operational reality.

Supervisors frequently manage multiple operational areas.

------------------------------------------------------------------------

# 12. Contractor Independence Principle

Contractors are not permanently attached to MAINHEADs.

------------------------------------------------------------------------

Reason

Operational contracts change.

Assignments change.

Regions change.

------------------------------------------------------------------------

Therefore:

MAINHEAD ownership must not depend on contractor ownership.

------------------------------------------------------------------------

# 13. Access Resolution Rules

MAINHEAD visibility resolved through:

1.  Direct Access

UserMainheadAccess

2.  Region Access

UserOperationalRegionAccess

3.  Team Access

4.  Branch Access

5.  Legacy Access

6.  Administrative Override

------------------------------------------------------------------------

# 14. Administrative Override

ADMIN users may view all active MAINHEADs.

------------------------------------------------------------------------

Reason

System administration.

------------------------------------------------------------------------

# 15. QA Override

ASCURA QA users may view all active MAINHEADs.

------------------------------------------------------------------------

Reason

Governance requires unrestricted visibility.

------------------------------------------------------------------------

# 16. Template Governance

Templates define operational requirements.

Templates are governance assets.

------------------------------------------------------------------------

Templates must never be edited directly once active.

------------------------------------------------------------------------

Reason

Inspection history integrity.

------------------------------------------------------------------------

Changes require:

New Version

Activation

Audit Record

------------------------------------------------------------------------

# 17. Template Scope Principle

Templates may exist at:

GLOBAL

ORGANIZATION

BRANCH

OPERATIONAL_REGION

MAINHEAD

------------------------------------------------------------------------

Reason

Operational variation.

------------------------------------------------------------------------

# 18. Template Resolution Principle

Most specific template wins.

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

# 19. Inspection Ownership

Inspection belongs to:

Asset

Site Visit

Inspector

Template Version

------------------------------------------------------------------------

Inspection history must remain immutable after submission.

------------------------------------------------------------------------

# 20. Defect Ownership

Defect originates from inspection findings.

------------------------------------------------------------------------

Defect must maintain links to:

Inspection

Asset

Site Visit

------------------------------------------------------------------------

Reason

Traceability.

------------------------------------------------------------------------

# 21. Defect Verification Principle

Not every detected defect is valid.

------------------------------------------------------------------------

Therefore:

Defects require verification.

------------------------------------------------------------------------

Lifecycle

DETECTED

↓

UNDER_REVIEW

↓

VERIFIED

or

REJECTED

------------------------------------------------------------------------

# 22. Assignment Principle

Only VERIFIED defects may be assigned.

------------------------------------------------------------------------

Reason

Prevent unnecessary maintenance work.

------------------------------------------------------------------------

# 23. Maintenance Principle

Maintenance acts on verified operational truth.

------------------------------------------------------------------------

Maintenance should never determine whether a defect exists.

------------------------------------------------------------------------

QA determines validity.

Maintenance executes repair.

------------------------------------------------------------------------

# 24. Closure Principle

Repair completion is not closure.

------------------------------------------------------------------------

Completion indicates:

Contractor states work is finished.

------------------------------------------------------------------------

Closure indicates:

QA accepts repair outcome.

------------------------------------------------------------------------

# 25. Evidence Principle

Every critical operational action requires evidence.

------------------------------------------------------------------------

Examples

Inspection photos

GPS

Repair photos

Completion notes

Verification notes

------------------------------------------------------------------------

# 26. Evidence Preservation Principle

Evidence must never be overwritten.

------------------------------------------------------------------------

New evidence may be added.

Historical evidence remains preserved.

------------------------------------------------------------------------

# 27. Audit Principle

Every critical action must be traceable.

------------------------------------------------------------------------

Required Audit Events

Inspection Submission

Approval

Rejection

Defect Verification

Assignment

Maintenance Completion

Closure Approval

Configuration Changes

------------------------------------------------------------------------

# 28. Offline Principle

Field work must continue without connectivity.

------------------------------------------------------------------------

Inspections

Photos

GPS

Maintenance evidence

must work offline.

------------------------------------------------------------------------

# 29. Sync Integrity Principle

Data must synchronize safely.

------------------------------------------------------------------------

Required Order

Inspection

↓

Photos

↓

Defects

↓

Visit Completion

------------------------------------------------------------------------

Reason

Prevent orphan records.

------------------------------------------------------------------------

# 30. Site Visit Principle

Site Visit is operational container.

------------------------------------------------------------------------

Contains

Assets

Inspections

Defects

Participants

Evidence

------------------------------------------------------------------------

# 31. Asset Principle

Asset represents operational reality.

------------------------------------------------------------------------

Operational Status

EXISTING

NEW

NOT_FOUND

DEMOLISHED

------------------------------------------------------------------------

# 32. SAVR Principle

SAVR focuses on pole-based inspections.

------------------------------------------------------------------------

One Site Visit may contain many poles.

------------------------------------------------------------------------

Each pole:

Independent inspection

Independent defects

Independent evidence

------------------------------------------------------------------------

# 33. SAVT Principle

SAVT represents route inspection.

------------------------------------------------------------------------

Route

Pencawang A

↓

Pencawang B

------------------------------------------------------------------------

One route

One operational session.

------------------------------------------------------------------------

# 34. Reporting Principle

Reports must be generated from verified operational data.

------------------------------------------------------------------------

Preferred Sources

Approved inspections

Verified defects

Closed maintenance records

------------------------------------------------------------------------

# 35. Operational Simplicity Principle

Users should focus on work.

Not system administration.

------------------------------------------------------------------------

UI should:

Minimize clicks

Reduce text

Reduce navigation

Highlight actions

------------------------------------------------------------------------

# 36. Governance Before Analytics

Operational integrity comes before analytics.

------------------------------------------------------------------------

Correct workflow is more important than dashboards.

Correct evidence is more important than charts.

------------------------------------------------------------------------

# 37. Governance Before AI

AI may assist.

AI must not override governance.

------------------------------------------------------------------------

AI recommendations require human authority.

------------------------------------------------------------------------

# 38. Future Governance Expansion

Future capabilities:

SLA Management

Escalation Rules

Automated Notifications

Contractor Scoring

Quality Scoring

Regional Performance Metrics

------------------------------------------------------------------------

# 39. Non-Negotiable Rules

QA belongs to ASCURA.

Only VERIFIED defects may be assigned.

Only QA may close defects.

Approved inspections hidden from technician queue.

Template history immutable.

Evidence preserved permanently.

Audit trail required.

MAINHEAD not contractor-owned.

Operational truth preserved.

------------------------------------------------------------------------

# 40. ASCURE Mission

ASCURE exists to provide a trusted operational truth layer between
inspection, maintenance, governance, and reporting.

Every workflow, feature, screen, API, and database decision should
support that mission.

------------------------------------------------------------------------

END OF ASCURE BLUEPRINT V6
