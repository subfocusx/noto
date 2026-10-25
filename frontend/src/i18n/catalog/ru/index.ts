// The catalogue of the strings in Russian.
//
// The file merges the areas of the language. It is the module that the loader
// of the catalogue imports: the entry chunk of the application does not hold
// a single string of the interface.
import { common } from './common';
import { shell } from './shell';
import { editor } from './editor';
import { dialogs } from './dialogs';
import { settings } from './settings';
import { commands } from './commands';
import { panels } from './panels';
import { tree } from './tree';
import { sidebar } from './sidebar';
import { app } from './app';
import { sections } from './sections';
import { vault } from './vault';

export const catalogue: Record<string, string> = {
  ...common,
  ...shell,
  ...editor,
  ...dialogs,
  ...settings,
  ...commands,
  ...panels,
  ...tree,
  ...sidebar,
  ...app,
  ...sections,
  ...vault,
};
