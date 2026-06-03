# ASCURE BLUEPRINT V9

# SAVR Operational Blueprint

Version: 1.0

Purpose:

Document the operational workflow, business rules, field practices, and
governance requirements for SAVR operations.

SAVR is the foundational operational domain of ASCURE and serves as the
reference implementation for inspection-driven workflows.

------------------------------------------------------------------------

# 1. What is SAVR

SAVR

Sesalur Atas Voltan Rendah

Represents Low Voltage Overhead Line infrastructure.

------------------------------------------------------------------------

Typical Assets

Utility Poles

Cross Arms

Insulators

Stay Wires

Conductors

Pole Attachments

Pole Equipment

------------------------------------------------------------------------

# 2. SAVR Operational Objective

Identify:

Asset condition

Defects

Safety risks

Maintenance requirements

Operational changes

------------------------------------------------------------------------

Output:

Verified operational record.

------------------------------------------------------------------------

# 3. Operational Ownership

Utility Owner

TNB

------------------------------------------------------------------------

Inspection

Contractor

------------------------------------------------------------------------

QA/QC

ASCURA

------------------------------------------------------------------------

Maintenance

Maintenance Contractor

------------------------------------------------------------------------

# 4. Operational Flow

AMK Issued

↓

Project Created

↓

Work Package Created

↓

Site Visit Created

↓

Check-In

↓

Asset Registration

↓

Inspection

↓

Defect Detection

↓

Submission

↓

QA Review

↓

Defect Verification

↓

Maintenance

↓

Closure

------------------------------------------------------------------------

# 5. Site Visit Concept

A Site Visit represents a field operation.

------------------------------------------------------------------------

Contains:

Pencawang

Poles

Inspections

Defects

Evidence

Participants

------------------------------------------------------------------------

# 6. Pencawang Concept

Pencawang acts as operational grouping.

------------------------------------------------------------------------

Examples

SS2-01

TMN MELAWATI-03

KLANG UTAMA-02

------------------------------------------------------------------------

Purpose

Group related poles.

Group reports.

Group inspections.

------------------------------------------------------------------------

# 7. Pole Concept

Each pole is an independent asset.

------------------------------------------------------------------------

Each pole may have:

Unique condition

Unique defects

Unique evidence

Unique maintenance history

------------------------------------------------------------------------

# 8. Asset Naming Convention

Current ASCURE Standard

NO TIANG RONDAAN

Operational pole number.

------------------------------------------------------------------------

NO TIANG LAMA

Legacy pole number.

------------------------------------------------------------------------

# 9. Pole Numbering Examples

Example

A 1

A 2

A 3

A 4

------------------------------------------------------------------------

Inserted Pole

A 4/1

------------------------------------------------------------------------

Additional Pole

A 4/1A

------------------------------------------------------------------------

Branch Extension

B 1

B 2

------------------------------------------------------------------------

Shared Pole

A 4 & B 1

------------------------------------------------------------------------

# 10. Asset Operational Status

EXISTING

Pole exists.

------------------------------------------------------------------------

NEW

New pole discovered.

------------------------------------------------------------------------

NOT_FOUND

Pole expected but not found.

------------------------------------------------------------------------

DEMOLISHED

Pole removed.

------------------------------------------------------------------------

# 11. Check-In Procedure

Technician arrives on site.

------------------------------------------------------------------------

Capture

GPS

Timestamp

User

Site Visit

------------------------------------------------------------------------

Stored automatically.

------------------------------------------------------------------------

# 12. Asset Registration Procedure

Create Pole.

------------------------------------------------------------------------

Capture

Pole Number

Legacy Number

GPS

Operational Status

Remarks

------------------------------------------------------------------------

# 13. GPS Capture Principle

GPS must represent actual field location.

------------------------------------------------------------------------

Required

Latitude

Longitude

Accuracy

Timestamp

------------------------------------------------------------------------

# 14. Inspection Template Structure

Inspection uses dynamic template.

------------------------------------------------------------------------

Example Sections

Pole Information

Structure

Conductor

Insulator

Stay Wire

Cross Arm

Attachments

Evidence

GPS

Remarks

------------------------------------------------------------------------

# 15. Pole Information Section

Example Fields

Pole Number

Pole Material

Pole Height

Pole Type

Operational Status

------------------------------------------------------------------------

# 16. Structure Section

Examples

Leaning Pole

Concrete Crack

Corrosion

Broken Pole

------------------------------------------------------------------------

Field Type

YES_NO

------------------------------------------------------------------------

# 17. Conductor Section

Examples

Broken Strand

Damaged Conductor

Sagging

Loose Connection

------------------------------------------------------------------------

Field Type

YES_NO

------------------------------------------------------------------------

# 18. Insulator Section

Examples

Broken

Cracked

Missing

Flashover Mark

------------------------------------------------------------------------

Field Type

YES_NO

------------------------------------------------------------------------

# 19. Stay Wire Section

Examples

Loose

Corroded

Missing

Damaged

------------------------------------------------------------------------

Field Type

YES_NO

------------------------------------------------------------------------

# 20. Cross Arm Section

Examples

Bent

Corroded

Broken

Missing Bolt

------------------------------------------------------------------------

Field Type

YES_NO

------------------------------------------------------------------------

# 21. Evidence Section

Required Images

Pole Overview

Defect Evidence

Additional Evidence

------------------------------------------------------------------------

Images must include:

Timestamp Overlay

GPS Overlay

------------------------------------------------------------------------

# 22. Conditional Logic Example

Broken Insulator = YES

↓

Show:

Severity

Quantity

Evidence Image

Remarks

------------------------------------------------------------------------

Implemented using showIf.

------------------------------------------------------------------------

# 23. Inspection Submission

Inspection validated.

------------------------------------------------------------------------

Required fields checked.

Required evidence checked.

------------------------------------------------------------------------

Then submitted.

------------------------------------------------------------------------

# 24. Defect Generation Rules

Example

Broken Insulator = YES

↓

Generate Defect

Category:

INSULATOR

------------------------------------------------------------------------

Sagging Conductor = YES

↓

Generate Defect

Category:

CONDUCTOR

------------------------------------------------------------------------

# 25. Defect Severity

Suggested Levels

LOW

MEDIUM

HIGH

CRITICAL

------------------------------------------------------------------------

Used for prioritization.

------------------------------------------------------------------------

# 26. QA Review

Performed by ASCURA.

------------------------------------------------------------------------

Review

Checklist

Evidence

GPS

Defect validity

------------------------------------------------------------------------

Actions

Approve

Reject

Request Amendment

------------------------------------------------------------------------

# 27. Rejection Workflow

Inspection Rejected

↓

Returns to technician

↓

Correction performed

↓

Resubmission

------------------------------------------------------------------------

# 28. Defect Verification

QA determines:

Valid

or

Invalid

------------------------------------------------------------------------

Valid

↓

VERIFIED

------------------------------------------------------------------------

Invalid

↓

REJECTED

------------------------------------------------------------------------

# 29. Maintenance Assignment

Only VERIFIED defects.

------------------------------------------------------------------------

Assigned by:

Manager

------------------------------------------------------------------------

Assigned to:

Maintenance Team

------------------------------------------------------------------------

# 30. Maintenance Workflow

Receive Defect

↓

Travel To Site

↓

Repair

↓

Capture Evidence

↓

Upload Evidence

↓

Mark Completed

------------------------------------------------------------------------

# 31. Maintenance Evidence

Examples

Before

After

Close-up

Wide View

------------------------------------------------------------------------

All timestamped.

------------------------------------------------------------------------

# 32. Completion Notes

Must describe:

Repair performed

Materials used

Operational outcome

------------------------------------------------------------------------

# 33. Closure Verification

Performed by ASCURA QA.

------------------------------------------------------------------------

Review

Repair evidence

Repair notes

Defect history

------------------------------------------------------------------------

Actions

Approve Closure

Reject Closure

Request Rework

------------------------------------------------------------------------

# 34. Closure Outcome

Approved

↓

CLOSED

------------------------------------------------------------------------

Rejected

↓

Returns to maintenance

------------------------------------------------------------------------

# 35. Reporting Requirements

Primary Report Unit

Pencawang

------------------------------------------------------------------------

Report Types

Excel Export

Visual Report

Operational Summary

------------------------------------------------------------------------

# 36. Excel Export Requirements

Include

Pole Number

Legacy Number

GPS

Inspection Results

Defects

Status

Remarks

------------------------------------------------------------------------

# 37. Visual Report Requirements

One page per asset.

------------------------------------------------------------------------

Contents

Pole Information

Images

Inspection Findings

Defects

GPS

Timestamp

------------------------------------------------------------------------

# 38. Operational Metrics

Future KPIs

Poles Inspected

Defects Found

Defects Closed

Average Closure Time

QA Rejection Rate

Maintenance Response Time

------------------------------------------------------------------------

# 39. Common Field Issues

GPS accuracy poor

No connectivity

Pole numbering inconsistencies

Missing historical labels

Duplicate assets

------------------------------------------------------------------------

ASCURE must support operational recovery from these conditions.

------------------------------------------------------------------------

# 40. SAVR Governance Rules

Every pole must be traceable.

Every defect must be verifiable.

Every repair must have evidence.

Every closure must be approved.

------------------------------------------------------------------------

No defect may bypass QA.

No closure may bypass QA.

------------------------------------------------------------------------

# 41. Pilot Validation Scenario

Example

Pencawang:

SS2-01

------------------------------------------------------------------------

Poles:

10

------------------------------------------------------------------------

Defects Generated:

3

------------------------------------------------------------------------

QA Verified:

3

------------------------------------------------------------------------

Maintenance Completed:

3

------------------------------------------------------------------------

Closed:

3

------------------------------------------------------------------------

Expected Result

Full operational traceability.

Complete audit trail.

Complete evidence preservation.

Governance rules enforced.

------------------------------------------------------------------------

# 42. ASCURE SAVR Mission

Provide a complete operational truth layer for SAVR inspections from
field execution through verified maintenance closure.

------------------------------------------------------------------------

END OF ASCURE BLUEPRINT V9
