# Project Setup - OYO-29

## Overview

This document describes the initial project setup for Gitable, implementing the conventions and rules defined in Linear ticket OYO-29.

## Ticket Information

- **Ticket ID**: OYO-29
- **Title**: Project setup
- **Branch**: `yoanndiguet/oyo-29-project-setup`
- **Date**: October 10, 2025

## Rules Implemented

Based on the Linear ticket requirements, the following rules have been established:

### 1. Block-quote to Cursor Rule Conversion
Each block-quote in Linear tickets should trigger the creation of a new cursor rule.

### 2. Branch Creation for Linear Tickets
When handling a Linear ticket, a new branch should be created each time, using the branch name provided by the Linear ticket.

### 3. Language Convention
All code and documentation should be written in English.

### 4. Documentation Requirement
Each time a Linear ticket is handled, documentation should be created in the folder `/docs/{ticket-name}/` where `{ticket-name}` is the name of the ticket.

## Project Structure

The following structure has been created:

```
gitable/
├── .cursorrules          # Cursor AI rules
├── README.md            # Project overview
└── docs/
    └── project-setup/   # This documentation
        └── README.md
```

## Implementation Details

- Created `.cursorrules` file with project conventions
- Established documentation structure in `/docs/` folder
- Created Git branch following Linear naming convention
- Set up English-only policy for all project content

## Next Steps

Future Linear tickets should follow these established conventions:
1. Create branch using Linear-provided name
2. Implement ticket requirements
3. Create documentation in `/docs/{ticket-name}/`
4. Follow English-only policy for all content
