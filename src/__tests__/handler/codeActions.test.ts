import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CodeAction, Command, CodeActionContext, CodeActionKind, TextEdit, Disposable, Range, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import commands from '../../commands'
import ActionsHandler from '../../handler/codeActions'
import languages from '../../languages'
import { ProviderResult } from '../../provider'
import { disposeAll } from '../../util'
import { rangeInRange } from '../../util/position'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let handler: ActionsHandler
let currActions: CodeAction[]
let resolvedAction: CodeAction
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  handler = (helper.plugin as any).handler.codeActions
  disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
    provideCodeActions: (
      _document: TextDocument,
      _range: Range,
      _context: CodeActionContext,
      _token: CancellationToken
    ) => currActions,
    resolveCodeAction: (
      _action: CodeAction,
      _token: CancellationToken
    ): ProviderResult<CodeAction> => resolvedAction
  }, undefined))
})

afterAll(async () => {
  disposeAll(disposables)
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
})

describe('handler codeActions', () => {
  describe('organizeImport', () => {
    it('should throw error when organize import action not found', async () => {
      currActions = []
      await helper.createDocument()
      let err
      try {
        await handler.organizeImport()
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })

    it('should perform organize import action', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
      let edits: TextEdit[] = []
      edits.push(TextEdit.replace(Range.create(0, 0, 0, 3), 'bar'))
      edits.push(TextEdit.replace(Range.create(1, 0, 1, 3), 'foo'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('organize import', edit, CodeActionKind.SourceOrganizeImports)
      currActions = [action, CodeAction.create('another action')]
      await handler.organizeImport()
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar', 'foo'])
    })
  })

  describe('getCodeActions', () => {
    it('should get empty actions', async () => {
      currActions = []
      let doc = await helper.createDocument()
      let res = await handler.getCodeActions(doc)
      expect(res.length).toBe(0)
    })

    it('should filter disabled actions', async () => {
      currActions = []
      let action = CodeAction.create('foo', CodeActionKind.QuickFix)
      action.disabled = { reason: 'disabled' }
      currActions.push(action)
      action = CodeAction.create('foo', CodeActionKind.QuickFix)
      action.disabled = { reason: 'disabled' }
      currActions.push(action)
      let doc = await helper.createDocument()
      let res = await handler.getCodeActions(doc)
      expect(res.length).toBe(0)
    })

    it('should get all actions', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.setLines(['', '', ''], { start: 0, end: -1, strictIndexing: false })
      let action = CodeAction.create('curr action', CodeActionKind.Empty)
      currActions = [action]
      let range: Range
      let disposable = languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: (
          _document: TextDocument,
          r: Range,
          _context: CodeActionContext, _token: CancellationToken
        ) => {
          range = r
          return [CodeAction.create('a'), CodeAction.create('b'), CodeAction.create('c')]
        },
      }, undefined)
      try {
        let res = await handler.getCodeActions(doc)
        expect(range).toEqual(Range.create(0, 0, 3, 0))
        expect(res.length).toBe(4)
        disposable.dispose()
      } catch (e) {
        disposable.dispose()
        throw e
      }
    })

    it('should filter actions by range', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.setLines(['', '', ''], { start: 0, end: -1, strictIndexing: false })
      currActions = []
      let range: Range
      let disposable = languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: (
          _document: TextDocument,
          r: Range,
          _context: CodeActionContext, _token: CancellationToken
        ) => {
          range = r
          if (rangeInRange(r, Range.create(0, 0, 1, 0))) return [CodeAction.create('a')]
          return [CodeAction.create('a'), CodeAction.create('b'), CodeAction.create('c')]
        },
      }, undefined)
      try {
        let res = await handler.getCodeActions(doc, Range.create(0, 0, 0, 0))
        expect(range).toEqual(Range.create(0, 0, 0, 0))
        expect(res.length).toBe(1)
        disposable.dispose()
      } catch (e) {
        disposable.dispose()
        throw e
      }
    })

    it('should filter actions by kind prefix', async () => {
      let doc = await helper.createDocument()
      let action = CodeAction.create('my action', CodeActionKind.SourceFixAll)
      currActions = [action]
      let res = await handler.getCodeActions(doc, undefined, [CodeActionKind.Source])
      expect(res.length).toBe(1)
      expect(res[0].kind).toBe(CodeActionKind.SourceFixAll)
    })
  })

  describe('getCurrentCodeActions', () => {
    let disposable: Disposable
    let range: Range
    beforeEach(() => {
      disposable = languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: (
          _document: TextDocument,
          r: Range,
          _context: CodeActionContext, _token: CancellationToken
        ) => {
          range = r
          return [CodeAction.create('a'), CodeAction.create('b'), CodeAction.create('c')]
        },
      }, undefined)
    })

    afterEach(() => {
      disposable.dispose()
    })

    it('should get codeActions by line', async () => {
      currActions = []
      await helper.createDocument()
      let res = await handler.getCurrentCodeActions('line')
      expect(range).toEqual(Range.create(0, 0, 1, 0))
      expect(res.length).toBe(3)
    })

    it('should get codeActions by cursor', async () => {
      currActions = []
      await helper.createDocument()
      let res = await handler.getCurrentCodeActions('cursor')
      expect(range).toEqual(Range.create(0, 0, 0, 0))
      expect(res.length).toBe(3)
    })

    it('should get codeActions by visual mode', async () => {
      currActions = []
      await helper.createDocument()
      await nvim.setLine('foo')
      await nvim.command('normal! 0v$')
      await nvim.input('<esc>')
      let res = await handler.getCurrentCodeActions('v')
      expect(range).toEqual(Range.create(0, 0, 0, 4))
      expect(res.length).toBe(3)
    })
  })

  describe('doCodeAction', () => {
    it('should not throw when no action exists', async () => {
      currActions = []
      await helper.createDocument()
      let err
      try {
        await handler.doCodeAction(undefined)
      } catch (e) {
        err = e
      }
      expect(err).toBeUndefined()
    })

    it('should apply single code action when only is title', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action]
      await handler.doCodeAction(undefined, 'code fix')
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })

    it('should apply single code action when only is codeAction array', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action]
      await handler.doCodeAction(undefined, [CodeActionKind.QuickFix])
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })

    it('should action dialog to choose action', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action, CodeAction.create('foo')]
      let promise = handler.doCodeAction(undefined)
      await helper.wait(50)
      let ids = await nvim.call('coc#float#get_float_win_list') as number[]
      expect(ids.length).toBeGreaterThan(0)
      await nvim.input('<CR>')
      await promise
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })
  })

  describe('doQuickfix', () => {
    it('should throw when quickfix action not exists', async () => {
      let err
      currActions = []
      await helper.createDocument()
      try {
        await handler.doQuickfix()
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })

    it('should do preferred quickfix action', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      action.isPreferred = true
      currActions = [CodeAction.create('foo', CodeActionKind.QuickFix), action]
      await handler.doQuickfix()
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })
  })

  describe('applyCodeAction', () => {
    it('should resolve codeAction', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', CodeActionKind.QuickFix)
      action.isPreferred = true
      currActions = [action]
      resolvedAction = Object.assign({ edit }, action)
      let arr = await handler.getCurrentCodeActions('line', [CodeActionKind.QuickFix])
      await handler.applyCodeAction(arr[0])
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })

    it('should throw for disabled action', async () => {
      let action = CodeAction.create('my action', CodeActionKind.Empty)
      action.disabled = { reason: 'disabled' }
      let err
      try {
        await handler.applyCodeAction(action)
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })

    it('should invoke registered command after apply edit', async () => {
      let called
      let disposable = commands.registerCommand('test.execute', async (s: string) => {
        called = s
        await nvim.command(s)
      })
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', CodeActionKind.QuickFix)
      action.isPreferred = true
      currActions = [action]
      resolvedAction = Object.assign({
        edit,
        command: Command.create('run vim command', 'test.execute', 'normal! $')
      }, action)
      let arr = await handler.getCurrentCodeActions('line', [CodeActionKind.QuickFix])
      await handler.applyCodeAction(arr[0])
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
      expect(called).toBe('normal! $')
      disposable.dispose()
    })
  })
})
