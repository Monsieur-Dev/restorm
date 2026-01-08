# TODO List

## Urgent Issues

### E2E Test Failure: Search Result Click
**Date:** 2026-01-08
**Status:** To investigate
**Priority:** High

**Description:**
The e2e test "Should find request in search and open tab on click" in `restorm/tests/e2e/bdd/search/features/search.feature` fails after the linting fixes commit.

**Error:**
```
TimeoutError: page.waitForSelector: Timeout 5000ms exceeded.
Call log:
  - waiting for locator('.tab.active') to be visible

at tests/e2e/bdd/search/steps/search.steps.ts:32
```

**Context:**
- The test times out waiting for `.tab.active` after clicking on a search result
- All other tests pass (13/14 tests passing)
- The failure occurs reproducibly
- Likely related to changes in `useNavigation.ts` hook or navigation flow

**Steps to Reproduce:**
1. Run `pnpm run test:e2e --grep "Should find request in search and open tab on click"`
2. Test clicks on first search result
3. Test waits for `.tab.active` selector
4. Times out after 5000ms

**Files to Investigate:**
- `restorm/src/renderer/src/hooks/useNavigation.ts` (line 162: `handleSearchResultClick`)
- `restorm/tests/e2e/bdd/search/steps/search.steps.ts` (line 32)
- `restorm/src/renderer/src/App.tsx` (navigation event handlers)

**Potential Causes:**
1. Navigation event not being triggered correctly after linting fixes
2. Tab not being marked as active due to state update issue
3. Timing issue - tab opens but not yet marked as active when selector runs
4. CSS class name changed or not being applied

**Next Steps:**
1. Uncomment the test in `search.feature`
2. Add more detailed logging in the test to see what's happening
3. Check if the tab actually opens but just isn't marked as active
4. Verify that `handleSearchResultClick` is being called correctly
5. Check if navigation service events are being emitted properly

