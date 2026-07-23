import { useTranslation } from 'react-i18next'
import { useGitState } from 'electron-core-ui/renderer'
import { useCapability } from './useCapability'

export type GitGateKind = 'enabled' | 'community' | 'no-git-folder'

export interface GitGateState {
  kind: GitGateKind
  /** True whenever git surfaces should render greyed + non-interactive
   * (both `'community'` and `'no-git-folder'` are locked states; only
   * `'enabled'` isn't). */
  locked: boolean
  /** Locked-state tooltip message. `undefined` for `'community'` —
   * `GatedControl`'s own default "Version Pro" copy already covers that
   * case; only `'no-git-folder'` needs a bespoke message. */
  message?: string
  /** Whether the locked tooltip shows the "Subscribe" call to action.
   * False for `'no-git-folder'` — a Pro user has nothing to buy there,
   * they just need to initialize git in the project's folder. */
  showSubscribeLink: boolean
}

/**
 * The 3-state git Pro-gate: (Pro + git repo) → enabled; (Pro + NOT a git
 * repo) → locked with an informational "initialize git" message and no
 * subscribe link; (Community, regardless of whether the folder happens
 * to be a git repo) → locked with the standard Pro upsell. One hook
 * drives every gated surface (status bar, title-bar Git menu,
 * Settings→Git) so they can never disagree on which of the 3 states
 * currently applies.
 */
export function useGitGateState(): GitGateState {
  const { t } = useTranslation()
  const hasCapability = useCapability('git.client')
  const { isRepo } = useGitState()

  if (!hasCapability) {
    return { kind: 'community', locked: true, showSubscribeLink: true }
  }
  if (!isRepo) {
    return {
      kind: 'no-git-folder',
      locked: true,
      message: t('git.gate.initGitFolder'),
      showSubscribeLink: false
    }
  }
  return { kind: 'enabled', locked: false, showSubscribeLink: true }
}
