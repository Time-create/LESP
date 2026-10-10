const { schema, textDoc } = require('../shared/document-schema');
const { EditorState } = require('prosemirror-state');
const { EditorView } = require('prosemirror-view');
const { history, undo, redo } = require('prosemirror-history');
const { keymap } = require('prosemirror-keymap');
const { baseKeymap } = require('prosemirror-commands');
window.spikeEditor = new EditorView(document.querySelector('#editor'), { state: EditorState.create({ schema, doc: schema.nodeFromJSON(textDoc('技术验证正文')), plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap)] }) });
