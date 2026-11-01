/**
 * Browser half of the MiraZero bridge settings page.
 *
 * Registers one section into `settings.section`, next to the host's own
 * settings. The section talks only to the plugin's local routes under
 * `/.dsh-mirazero-bridge`; the API key never travels back to the browser.
 *
 * Client plugin files share one top-level scope in the shell, so everything is
 * wrapped in an IIFE and the exported module is returned from the factory.
 */
;(() => {
  const PREFIX = '/.dsh-mirazero-bridge'
  const STYLE_ID = 'dsh-mirazero-bridge-style'

  const COPY = {
    zh: {
      nav: 'MiraZero',
      title: 'MiraZero 桥接',
      intro: '把 MiraZero 上绑定的公开模型接到这台电脑的 DSH：每个请求一个独立会话，角色卡来自下方设置，工具面为空。',
      connection: '连接',
      baseUrl: '站点地址',
      baseUrlHint: '填站点根地址，或模型设置里“Agent 平台”给出的 Base URL；/api/integrations/v1 会自动去掉。',
      apiKey: '第三方接入 Key',
      apiKeyHint: '模型设置 → 第三方接入 → Agent 平台，创建 mzi_... 专用 Key。',
      apiKeySaved: '已保存，留空表示不修改。',
      keyPresent: 'Key 已保存',
      keyAbsent: '尚未保存 Key',
      clearKey: '清除 Key',
      autoStart: 'DSH 启动后自动开始轮询',
      save: '保存连接',
      saving: '保存中…',
      check: '检查已保存连接',
      checking: '检查中…',
      start: '开始轮询',
      starting: '启动中…',
      stop: '停止',
      saved: '连接已保存',
      checked: '连接正常',
      connectedModel: '可用模型',
      loadFailed: '读取设置失败',
      saveFailed: '保存失败',
      actionFailed: '操作失败',
      running: '运行中',
      stopped: '已停止',
      configured: '已配置',
      unconfigured: '未配置',
      missing: '缺少',
      lastError: '上次错误',
      fullContext: '完整上下文',
      features: '功能开关',
      featuresHint: '修改后立即生效；正在处理的请求使用开启时的设置。',
      character: '角色卡',
      characterHint: '这些字段会注入每个新会话的 system prompt；留空使用默认值。',
      name: '角色名',
      description: '角色简介',
      personality: '性格',
      speechStyle: '说话方式',
      saveCharacter: '保存角色卡',
      characterSaved: '角色卡已保存',
      featureNames: {
        images: '接收图片',
        remoteImages: '抓取公网图片',
        autoSearch: '自动检索',
        siteHistory: '使用站点历史',
        clientCard: '使用客户端角色卡',
        characterCard: '注入角色卡',
        lorebook: '世界设定',
        examples: '对话示例',
        selfAwareness: '角色自我认知',
        postHistory: '本轮附加要求',
        authorNote: '作者注',
        firstMessage: '角色开场',
      },
      loading: '读取中…',
      banner: '保存后立即生效；正在轮询时，连接变化会自动重启桥接。',
    },
    en: {
      nav: 'MiraZero',
      title: 'MiraZero bridge',
      intro: 'Serve a model bound on MiraZero with this DSH: one isolated Session per request, the character card below, no tools.',
      connection: 'Connection',
      baseUrl: 'Site address',
      baseUrlHint: 'Site root, or the Agent platform Base URL from model settings; /api/integrations/v1 is stripped.',
      apiKey: 'Integration key',
      apiKeyHint: 'Create an mzi_... key in model settings → third-party access → Agent platform.',
      apiKeySaved: 'Saved; leave blank to keep it.',
      keyPresent: 'Key saved',
      keyAbsent: 'No key saved',
      clearKey: 'Clear key',
      autoStart: 'Start polling when DSH launches',
      save: 'Save connection',
      saving: 'Saving…',
      check: 'Check saved connection',
      checking: 'Checking…',
      start: 'Start polling',
      starting: 'Starting…',
      stop: 'Stop',
      saved: 'Connection saved',
      checked: 'Connection OK',
      connectedModel: 'Model',
      loadFailed: 'Could not read settings',
      saveFailed: 'Save failed',
      actionFailed: 'Action failed',
      running: 'Running',
      stopped: 'Stopped',
      configured: 'Configured',
      unconfigured: 'Not configured',
      missing: 'Missing',
      lastError: 'Last error',
      fullContext: 'Full context',
      features: 'Features',
      featuresHint: 'Applied immediately; the request already in flight keeps the values it started with.',
      character: 'Character card',
      characterHint: 'Injected into each new Session system prompt; empty fields use defaults.',
      name: 'Name',
      description: 'Description',
      personality: 'Personality',
      speechStyle: 'Speech style',
      saveCharacter: 'Save character card',
      characterSaved: 'Character card saved',
      featureNames: {
        images: 'Images',
        remoteImages: 'Remote images',
        autoSearch: 'Auto search',
        siteHistory: 'Site history',
        clientCard: 'Client card',
        characterCard: 'Character card',
        lorebook: 'Lorebook',
        examples: 'Examples',
        selfAwareness: 'Self-awareness',
        postHistory: 'Post-history',
        authorNote: 'Author note',
        firstMessage: 'First message',
      },
      loading: 'Loading…',
      banner: 'Changes apply immediately; a running bridge restarts when the connection changes.',
    },
  }

  const FEATURE_KEYS = [
    'images',
    'remoteImages',
    'autoSearch',
    'siteHistory',
    'clientCard',
    'characterCard',
    'lorebook',
    'examples',
    'selfAwareness',
    'postHistory',
    'authorNote',
    'firstMessage',
  ]

  const STYLES = `
.dsh-mz { display:flex; flex-direction:column; gap:22px; max-width:680px; font-size:13px; line-height:1.5; color:var(--dsw-alias-label-primary,#1f1f1f); }
.dsh-mz h3 { margin:0; font-size:14px; font-weight:600; }
.dsh-mz h4 { margin:0 0 2px; font-size:13px; font-weight:600; }
.dsh-mz p { margin:0; }
.dsh-mz .muted { font-size:12px; line-height:1.6; color:var(--dsw-alias-label-secondary,#666); }
.dsh-mz .hint { font-size:11px; line-height:1.6; color:var(--dsw-alias-label-tertiary,#999); }
.dsh-mz .group { display:flex; flex-direction:column; gap:14px; padding-top:14px; border-top:0.5px solid var(--dsw-alias-border-l2,#e3e3e3); }
.dsh-mz .field { display:flex; flex-direction:column; gap:4px; }
.dsh-mz .field > label { font-size:12px; font-weight:500; color:var(--dsw-alias-label-secondary,#444); }
.dsh-mz input[type=text], .dsh-mz input[type=password], .dsh-mz textarea {
  box-sizing:border-box; width:100%; padding:7px 10px; font:inherit; font-size:12px; color:inherit;
  background:var(--dsw-alias-bg-layer-2,#fff); border:0.5px solid var(--dsw-alias-border-l2,#d8d8d8); border-radius:6px;
}
.dsh-mz textarea { min-height:64px; resize:vertical; line-height:1.55; }
.dsh-mz input:focus-visible, .dsh-mz textarea:focus-visible { outline:none; border-color:var(--dsw-alias-border-focus,#4d6bfe); box-shadow:0 0 0 1px var(--dsw-alias-border-focus,#4d6bfe); }
.dsh-mz input:disabled, .dsh-mz textarea:disabled { opacity:.6; }
.dsh-mz .check { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--dsw-alias-label-secondary,#444); }
.dsh-mz .check input { margin:0; }
.dsh-mz .actions { display:flex; flex-wrap:wrap; gap:8px; }
.dsh-mz button {
  font:inherit; font-size:12px; line-height:1.4; padding:6px 14px; cursor:pointer; border-radius:6px;
  border:0.5px solid var(--dsw-alias-border-l2,#d8d8d8); background:var(--dsw-alias-bg-layer-2,#fff); color:inherit;
}
.dsh-mz button:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-3,#f2f2f2); }
.dsh-mz button:disabled { opacity:.55; cursor:default; }
.dsh-mz button.primary { border-color:transparent; background:var(--dsw-alias-button-primary-bg,#4d6bfe); color:var(--dsw-alias-button-primary-text,#fff); }
.dsh-mz button.primary:hover:not(:disabled) { background:var(--dsw-alias-button-primary-bg-hover,#3f5ce0); }
.dsh-mz .status { display:flex; flex-wrap:wrap; gap:6px 14px; font-size:12px; color:var(--dsw-alias-label-secondary,#555); }
.dsh-mz .status span { display:inline-flex; align-items:center; gap:5px; }
.dsh-mz .dot { width:6px; height:6px; border-radius:50%; background:var(--dsw-alias-label-tertiary,#999); }
.dsh-mz .dot.on { background:var(--dsw-alias-status-success,#3b9e4b); }
.dsh-mz .notice { font-size:12px; line-height:1.6; }
.dsh-mz .notice.ok { color:var(--dsw-alias-status-success,#2f8a3c); }
.dsh-mz .notice.err { color:var(--dsw-alias-status-danger,#c0392b); }
.dsh-mz .feature-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:8px 16px; }
.dsh-mz .feature { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--dsw-alias-label-secondary,#444); }
.dsh-mz .feature code { font-size:11px; color:var(--dsw-alias-label-tertiary,#888); }
  `

  function currentText() {
    try {
      const language = `${document.documentElement?.lang || ''}${navigator.language || ''}`.toLowerCase()
      return language.startsWith('zh') ? COPY.zh : COPY.en
    } catch {
      return COPY.zh
    }
  }

  function installStyles() {
    try {
      if (document.getElementById(STYLE_ID)) return () => {}
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLES
      document.head.append(style)
      return () => style.remove?.()
    } catch {
      return () => {}
    }
  }

  async function request(path, options) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: {
        accept: 'application/json',
        ...(options?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options?.headers ?? {}),
      },
    })
    const raw = await response.text()
    let body
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      body = { error: raw.slice(0, 200) }
    }
    if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
    return body
  }

  window.__ModuleLoader__.load({
    id: 'dsh-mirazero-bridge',
    factory: (require) => {
      const React = require('react')
      const h = React.createElement
      const { useCallback, useEffect, useState } = React
      const t = currentText()

      function Field(props) {
        return h(
          'div',
          { className: 'field' },
          h('label', { htmlFor: props.id }, props.label),
          props.multiline
            ? h('textarea', {
                id: props.id,
                value: props.value,
                placeholder: props.placeholder || '',
                disabled: props.disabled === true,
                rows: props.rows || 3,
                onChange: (event) => props.onChange(event.target.value),
              })
            : h('input', {
                id: props.id,
                type: props.type || 'text',
                value: props.value,
                placeholder: props.placeholder || '',
                autoComplete: props.autoComplete || 'off',
                spellCheck: false,
                disabled: props.disabled === true,
                onChange: (event) => props.onChange(event.target.value),
              }),
          props.hint ? h('p', { className: 'hint' }, props.hint) : null,
        )
      }

      function Feature(props) {
        return h(
          'label',
          { className: 'feature' },
          h('input', {
            type: 'checkbox',
            checked: props.checked === true,
            disabled: props.disabled === true,
            onChange: (event) => props.onChange(event.target.checked),
          }),
          h('span', null, props.label),
          h('code', null, props.name),
        )
      }

      function MiraZeroSettings() {
        const [state, setState] = useState({
          loading: true,
          busy: '',
          error: '',
          notice: '',
          config: {},
          features: {},
          character: {},
          apiKey: '',
        })

        const load = useCallback(async () => {
          try {
            const [config, features, character] = await Promise.all([
              request(`${PREFIX}/config`),
              request(`${PREFIX}/features`),
              request(`${PREFIX}/character`),
            ])
            setState((prev) => ({
              ...prev,
              loading: false,
              error: '',
              config: config?.config || {},
              features: features?.features || {},
              character: character?.character || {},
            }))
          } catch (error) {
            setState((prev) => ({
              ...prev,
              loading: false,
              error: `${t.loadFailed}: ${error instanceof Error ? error.message : String(error)}`,
            }))
          }
        }, [])

        useEffect(() => {
          void load()
        }, [load])

        const run = async (key, work) => {
          setState((prev) => ({ ...prev, busy: key, error: '', notice: '' }))
          try {
            await work()
          } catch (error) {
            setState((prev) => ({
              ...prev,
              busy: '',
              error: `${key === 'save' || key === 'character' ? t.saveFailed : t.actionFailed}: ${error instanceof Error ? error.message : String(error)}`,
            }))
          }
        }

        const patchConfig = (fields) =>
          setState((prev) => ({ ...prev, config: { ...prev.config, ...fields } }))
        const patchCharacter = (fields) =>
          setState((prev) => ({ ...prev, character: { ...prev.character, ...fields } }))

        const saveConnection = () =>
          run('save', async () => {
            const body = {
              baseUrl: state.config.baseUrl || '',
              autoStart: state.config.autoStart === true,
            }
            if (state.apiKey.trim()) body.apiKey = state.apiKey.trim()
            const result = await request(`${PREFIX}/config`, {
              method: 'POST',
              body: JSON.stringify(body),
            })
            setState((prev) => ({
              ...prev,
              busy: '',
              apiKey: '',
              notice: t.saved,
              config: result?.config || prev.config,
            }))
          })

        const clearKey = () =>
          run('clear', async () => {
            const result = await request(`${PREFIX}/config`, {
              method: 'POST',
              body: JSON.stringify({ clearApiKey: true }),
            })
            setState((prev) => ({ ...prev, busy: '', apiKey: '', notice: t.saved, config: result?.config || prev.config }))
          })

        const checkConnection = () =>
          run('check', async () => {
            const result = await request(`${PREFIX}/models`)
            const models = Array.isArray(result?.models) ? result.models : []
            const name = models[0]?.name || models[0]?.id || ''
            setState((prev) => ({
              ...prev,
              busy: '',
              notice: name ? `${t.checked}: ${name}` : t.checked,
            }))
            await load()
          })

        const control = (path) =>
          run(path, async () => {
            await request(`${PREFIX}/${path}`, { method: 'POST', body: '{}' })
            await load()
            setState((prev) => ({ ...prev, busy: '' }))
          })

        const toggleFeature = async (key, value) => {
          const previous = state.features
          const next = { ...previous, [key]: value }
          setState((prev) => ({ ...prev, features: next }))
          try {
            const result = await request(`${PREFIX}/features`, {
              method: 'POST',
              body: JSON.stringify(next),
            })
            setState((prev) => ({ ...prev, features: result?.features || next }))
          } catch (error) {
            setState((prev) => ({
              ...prev,
              features: previous,
              error: `${t.actionFailed}: ${error instanceof Error ? error.message : String(error)}`,
            }))
          }
        }

        const saveCharacter = () =>
          run('character', async () => {
            const result = await request(`${PREFIX}/character`, {
              method: 'POST',
              body: JSON.stringify(state.character),
            })
            setState((prev) => ({
              ...prev,
              busy: '',
              notice: t.characterSaved,
              character: result?.character || prev.character,
            }))
          })

        if (state.loading) return h('div', { className: 'dsh-mz' }, h('p', { className: 'muted' }, t.loading))

        const config = state.config || {}
        const features = state.features || {}
        const character = state.character || {}
        const disabled = state.busy !== ''
        const configured = config.configured === true
        const running = config.running === true

        return h(
          'div',
          { className: 'dsh-mz' },
          h('div', null, h('h3', null, t.title), h('p', { className: 'muted' }, t.intro)),
          h(
            'div',
            { className: 'group' },
            h('h4', null, t.connection),
            h(Field, {
              id: 'dsh-mz-base-url',
              label: t.baseUrl,
              value: config.baseUrl || '',
              placeholder: 'https://mirazero.example.com',
              hint: t.baseUrlHint,
              disabled,
              onChange: (value) => patchConfig({ baseUrl: value }),
            }),
            h(Field, {
              id: 'dsh-mz-api-key',
              label: t.apiKey,
              type: 'password',
              value: state.apiKey,
              placeholder: config.apiKeyPresent ? config.apiKeyHint || t.apiKeySaved : 'mzi_...',
              hint: config.apiKeyPresent ? `${t.keyPresent} ${config.apiKeyHint || ''} · ${t.apiKeySaved}` : t.apiKeyHint,
              disabled,
              onChange: (value) => setState((prev) => ({ ...prev, apiKey: value })),
            }),
            h(
              'label',
              { className: 'check' },
              h('input', {
                type: 'checkbox',
                checked: config.autoStart === true,
                disabled,
                onChange: (event) => patchConfig({ autoStart: event.target.checked }),
              }),
              h('span', null, t.autoStart),
            ),
            h(
              'div',
              { className: 'actions' },
              h('button', { type: 'button', className: 'primary', disabled, onClick: saveConnection }, state.busy === 'save' ? t.saving : t.save),
              h('button', { type: 'button', disabled, onClick: checkConnection }, state.busy === 'check' ? t.checking : t.check),
              h('button', { type: 'button', disabled, onClick: () => control('start') }, state.busy === 'start' ? t.starting : t.start),
              h('button', { type: 'button', disabled: disabled || !running, onClick: () => control('stop') }, t.stop),
              config.apiKeyPresent ? h('button', { type: 'button', disabled, onClick: clearKey }, t.clearKey) : null,
            ),
            h(
              'div',
              { className: 'status' },
              h('span', null, h('i', { className: `dot${running ? ' on' : ''}` }), running ? t.running : t.stopped),
              h('span', null, configured ? t.configured : t.unconfigured),
              Array.isArray(config.missing) && config.missing.length ? h('span', null, `${t.missing}: ${config.missing.join(', ')}`) : null,
              h('span', null, `${t.fullContext}: ${config.fullContext === true ? '✓' : '—'}`),
              config.lastError ? h('span', null, `${t.lastError}: ${config.lastError}`) : null,
            ),
            state.notice ? h('p', { className: 'notice ok' }, state.notice) : null,
            state.error ? h('p', { className: 'notice err', role: 'alert' }, state.error) : null,
          ),
          h(
            'div',
            { className: 'group' },
            h('h4', null, t.features),
            h('p', { className: 'hint' }, t.featuresHint),
            h(
              'div',
              { className: 'feature-grid' },
              ...FEATURE_KEYS.map((key) =>
                h(Feature, {
                  key,
                  name: key,
                  label: t.featureNames?.[key] || key,
                  checked: features[key] !== false,
                  disabled,
                  onChange: (value) => toggleFeature(key, value),
                }),
              ),
            ),
          ),
          h(
            'div',
            { className: 'group' },
            h('h4', null, t.character),
            h('p', { className: 'hint' }, t.characterHint),
            h(Field, {
              id: 'dsh-mz-name',
              label: t.name,
              value: character.name || '',
              disabled,
              onChange: (value) => patchCharacter({ name: value }),
            }),
            h(Field, {
              id: 'dsh-mz-description',
              label: t.description,
              value: character.description || '',
              multiline: true,
              disabled,
              onChange: (value) => patchCharacter({ description: value }),
            }),
            h(Field, {
              id: 'dsh-mz-personality',
              label: t.personality,
              value: character.personality || '',
              multiline: true,
              disabled,
              onChange: (value) => patchCharacter({ personality: value }),
            }),
            h(Field, {
              id: 'dsh-mz-speech',
              label: t.speechStyle,
              value: character.speechStyle || '',
              disabled,
              onChange: (value) => patchCharacter({ speechStyle: value }),
            }),
            h(
              'div',
              { className: 'actions' },
              h('button', { type: 'button', disabled, onClick: saveCharacter }, state.busy === 'character' ? t.saving : t.saveCharacter),
            ),
          ),
          h('p', { className: 'hint' }, t.banner),
        )
      }

      const name = 'dsh-mirazero-bridge'
      const inject = ['slots']

      function apply(ctx) {
        ctx.effect(() => {
          const removeStyles = installStyles()
          const dispose = ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'mirazero',
                order: 45,
                label: () => currentText().nav,
              },
              MiraZeroSettings,
            ),
          )
          return () => {
            if (typeof dispose === 'function') dispose()
            removeStyles()
          }
        })
      }

      return { name, inject, apply }
    },
  })
})()
