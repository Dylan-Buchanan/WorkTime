---
name: issue-creation
description: Create a well-formatted Github issue based on user description
---

# Issue Creation

Create a simple and clear Github issue that another software engineer or a coding agent could pick up and easily complete.

## Overview

- Create the issue as a markdown file at `docs/issues/issue-<issue-number>.md`.
- You can use `git log` to see what number this issue should be chronologically if not specified by the user directly.
- If the user specifies a github issue number than use that.
- If you are creating multiple issues at once then the issues should be numbered based on the order in which they should be completed.
- The goal is to explain the issue clearly, give background information, state the work that must be done clearly, and give code information and file references
- The issue markdown template can be found in `references/issue-template.md`

## Content

The following topics are what should be included in an issue

- Complexity Classification
- Severity Classification
- Research Still Required
- A Clear Summary of the Issue
- Steps to Reproduce the Context of the Issue
- Expected Behavior
- Actual Behavior
- Requirements to Complete the Issue
- Testing Instructions
- Context in the Form of Code Snippets and File References

## Instructions

1. Research the codebase for a basic understanding of the issue presented
2. Gather information from the user about what is the problem and what should be done
    - Ask questions about the problem or feature
    - Ask questions about scope
    - Ask questions about the desired outcome
3. Perform any follow up research necessary
4. Determine if the issue should be broken up into several issues
5. Write the issue(s) as `docs/issues/issue-<issue-number>.md`
