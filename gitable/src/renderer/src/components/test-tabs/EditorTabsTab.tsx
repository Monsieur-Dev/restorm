import React from 'react'
import type { EditorTab, WorkbenchTree } from 'electron-vscodelike-core-ui/renderer'
import { Workbench } from '../Workbench'

const createTab = (id: string, title: string, dirty = false): EditorTab => ({ id, title, isDirty: dirty })

interface DemoTabGroup { id: string, tabs: EditorTab[], activeTabId?: string }
interface DemoContainer { id: string, orientation: 'vertical' | 'horizontal', groups: DemoNode[] }
type DemoNode = DemoTabGroup | DemoContainer
interface DemoTree extends WorkbenchTree { groups: DemoNode[] }

// Generate GUIDs for tabs
const tabId1 = crypto.randomUUID()
const tabId2 = crypto.randomUUID()
const tabId3 = crypto.randomUUID()
const tabId4 = crypto.randomUUID()

const initialTree: DemoTree = {
  orientation: 'vertical',
  groups: [
    {
      id: 'group-1',
      tabs: [
        createTab(tabId1, 'README.md', false),
        createTab(tabId2, 'main.ts', true),
        createTab(tabId3, 'app.css', false)
      ],
      activeTabId: tabId2
    },
    {
      id: 'group-2',
      tabs: [
        createTab(tabId4, 'notes.txt', false)
      ],
      activeTabId: tabId4
    }
  ]
}

const EditorTabsTab: React.FC = () => {
  const initialTabContentMap: Record<string, string> = {
    [tabId1]: '# Gitable\n\nDemo document view for README.',
    [tabId2]: 'export const main = () => {\n  console.log(\'Hello\');\n}',
    [tabId3]: ':root { --color: #09f; }',
    [tabId4]: '- Drag & drop between groups\n- Resize with the splitter'
  }

  return (
    <Workbench
      tree={initialTree}
      initialTabContentMap={initialTabContentMap}
    />
  )
}

export default EditorTabsTab
