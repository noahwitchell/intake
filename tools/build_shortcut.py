#!/usr/bin/env python3
"""Builds shortcut/Copy-to-Intake.shortcut: a Safari Share-menu shortcut that copies the page's
recipe/nutrition data (JSON-LD), any selected text and the page text, for pasting into Intake.
Run on the Mac (needs `shortcuts sign`):  python3 tools/build_shortcut.py"""
import plistlib, subprocess, uuid, pathlib, tempfile
root = pathlib.Path(__file__).resolve().parent.parent
JS = r"""var ld = [];
document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) { try { ld.push(JSON.parse(s.textContent)); } catch (e) {} });
var sel = String(window.getSelection() || '');
var txt = (document.body && document.body.innerText || '').slice(0, 40000);
completion(JSON.stringify({ intake: 1, url: location.href, title: document.title, ld: ld, selection: sel, text: txt }));"""
js_id = str(uuid.uuid4()).upper()
tok = lambda v: {'Value': v, 'WFSerializationType': 'WFTextTokenAttachment'}
wf = {
    'WFWorkflowClientVersion': '2605.0.5',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59511},
    'WFWorkflowImportQuestions': [],
    'WFWorkflowTypes': ['ActionExtension'],
    'WFWorkflowInputContentItemClasses': ['WFSafariWebPageContentItem'],
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowActions': [
        {'WFWorkflowActionIdentifier': 'is.workflow.actions.runjavascriptonwebpage',
         'WFWorkflowActionParameters': {'UUID': js_id, 'WFInput': tok({'Type': 'ExtensionInput'}), 'WFJavaScript': JS}},
        {'WFWorkflowActionIdentifier': 'is.workflow.actions.setclipboard',
         'WFWorkflowActionParameters': {'WFInput': tok({'Type': 'ActionOutput', 'OutputUUID': js_id, 'OutputName': 'Result from JavaScript'}),
                                         'WFLocalOnly': True}},
        {'WFWorkflowActionIdentifier': 'is.workflow.actions.notification',
         'WFWorkflowActionParameters': {'WFNotificationActionTitle': 'Copied for Intake',
                                         'WFNotificationActionBody': 'Open Intake, tap + then Paste a recipe or nutrition facts, and tap Paste.',
                                         'WFNotificationActionSound': False}},
    ],
}
with tempfile.TemporaryDirectory() as d:
    raw = pathlib.Path(d) / 'raw.shortcut'
    raw.write_bytes(plistlib.dumps(wf, fmt=plistlib.FMT_BINARY))
    out = root / 'shortcut' / 'Copy-to-Intake.shortcut'
    subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', str(raw), '--output', str(out)], check=True)
    print('wrote', out, out.stat().st_size, 'bytes')
