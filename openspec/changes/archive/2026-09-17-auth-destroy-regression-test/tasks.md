## 1. Test update

- [x] 1.1 In `packages/backend/src/routes/__tests__/auth.test.ts`, in the "should complete sign-in flow and redirect to team page for user with memberships" test (~line 323), replace `const app = await buildApp();` with mock captures: `const mockDestroy = vi.fn();`, `const mockRegenerate = vi.fn();`, and `const app = await buildApp({ destroy: mockDestroy, regenerate: mockRegenerate });`.
- [x] 1.2 Immediately before the test's closing `});` (~line 371), after the existing `successCall![2]` `toMatchObject` assertions, add `expect(mockRegenerate).toHaveBeenCalledTimes(1);` and `expect(mockDestroy).not.toHaveBeenCalled();`.

## 2. Verification

- [x] 2.1 Run the backend test suite (`packages/backend`) and confirm the modified test passes.
- [x] 2.2 Temporarily reintroduce a `session.destroy()` call ahead of `session.regenerate()` in `packages/backend/src/routes/auth.ts`'s callback success path, confirm the modified test fails, then revert the temporary change.
- [x] 2.3 Confirm no other test in `auth.test.ts` regressed (`vi.clearAllMocks()` in `beforeEach` isolates this override to the one test).
