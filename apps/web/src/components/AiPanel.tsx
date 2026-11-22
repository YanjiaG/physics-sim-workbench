import { useEffect, useRef, useState } from 'react';
import type { Proposal } from '@psw/core';
import { EXAMPLE_UTTERANCES, previewProposal } from '@psw/core';
import { useApp } from '../store';
import { fmtParamValue } from '../lib/format';

const INTENT_LABEL: Record<Proposal['intent'], string> = {
  modify: '参数提案',
  switch_model: '切换模型',
  compare: '对比',
  explain: '解释',
  unknown: '未识别',
};

function ProposalCard({ messageId, proposal }: { messageId: string; proposal: Proposal }) {
  const scene = useApp((state) => state.scene);
  const applyProposal = useApp((state) => state.applyProposal);
  const dismissProposal = useApp((state) => state.dismissProposal);
  const preview = previewProposal(scene, proposal);
  const stale = !preview.error && preview.diff.length === 0 && proposal.ops.length > 0;

  return (
    <div className="proposal">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="chip accent">{INTENT_LABEL[proposal.intent]}</span>
        {proposal.source === 'llm' ? <span className="chip">LLM</span> : <span className="chip">规则</span>}
      </div>
      {preview.diff.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {preview.diff.map((item) => (
            <div key={item.key} className="diff-row">
              <span className="diff-key">{item.label}</span>
              <span className="diff-from">{fmtParamValue(item.from)}</span>
              <span className="diff-arrow">→</span>
              <span className="diff-to">
                {fmtParamValue(item.to)}
                {item.unit ? ` ${item.unit}` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {stale ? <div className="field-hint">场景已更新，这份提案不再改变任何数值。</div> : null}
      {preview.error ? <div className="issue error">{preview.error}</div> : null}
      {proposal.warnings.length > 0 ? (
        <ul className="warn-list">
          {proposal.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <div className="proposal-actions">
        {proposal.compare ? (
          <button type="button" className="btn primary small" onClick={() => applyProposal(messageId)}>
            生成对比
          </button>
        ) : (
          <button
            type="button"
            className="btn primary small"
            disabled={proposal.ops.length === 0 || Boolean(preview.error)}
            onClick={() => applyProposal(messageId)}
          >
            应用
          </button>
        )}
        <button type="button" className="btn ghost small" onClick={() => dismissProposal(messageId)}>
          忽略
        </button>
      </div>
    </div>
  );
}

export function AiPanel() {
  const messages = useApp((state) => state.messages);
  const busy = useApp((state) => state.busy);
  const send = useApp((state) => state.send);
  const aiEnabled = useApp((state) => state.aiEnabled);
  const aiModel = useApp((state) => state.aiModel);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    void send(value);
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="panel-title">AI 对话</span>
        <span style={{ flex: 1 }} />
        <span className="chip" title={aiEnabled ? `模型：${aiModel ?? '默认'}` : '未配置 API 密钥，使用离线规则解析'}>
          {aiEnabled ? `LLM 已连接` : '离线模式'}
        </span>
      </div>
      <div className="chat">
        <div className="chat-scroll" ref={scrollRef}>
          {messages.map((message) => (
            <div key={message.id} className={`msg ${message.role}`}>
              <div className="bubble">{message.text}</div>
              {message.warnings && message.warnings.length > 0 ? (
                <ul className="warn-list">
                  {message.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              {message.pending?.map((item) => (
                <div key={item.question} className="pending-item">
                  {item.question}
                </div>
              ))}
              {message.proposal ? <ProposalCard messageId={message.id} proposal={message.proposal} /> : null}
              {message.role === 'assistant' && message.source ? (
                <span className="msg-meta">{message.source === 'llm' ? '来自语言模型' : '来自离线规则'}</span>
              ) : null}
            </div>
          ))}
          {busy ? (
            <div className="msg assistant">
              <div className="bubble" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" />
                正在理解你的描述…
              </div>
            </div>
          ) : null}
        </div>
        <div className="composer">
          <div className="examples">
            {EXAMPLE_UTTERANCES.map((example) => (
              <button
                key={example}
                type="button"
                className="example-chip"
                onClick={() => {
                  setText(example);
                  textareaRef.current?.focus();
                }}
              >
                {example}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            placeholder="例如：把质量改成 2 kg，摩擦系数 0.15；或者问「为什么滑块最后停下来了」"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-row">
            <span className="field-hint">Enter 发送 · Shift+Enter 换行</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={submit}>
              发送
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
