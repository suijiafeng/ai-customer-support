import React, { useEffect } from 'react';
import './embed.css';

// 默认消费同源托管的 widget 产物；独立部署时通过 VITE_WIDGET_SRC 指向实际部署地址
const WIDGET_SRC = import.meta.env.VITE_WIDGET_SRC || '/widget/widget.js';
const WORKSTATION_URL = import.meta.env.VITE_WORKSTATION_URL || '/workstation/';
const API_BASE = import.meta.env.VITE_API_BASE || '';

/**
 * Widget 嵌入演示：模拟第三方网站，通过 <script src="/widget/widget.js"> 消费
 * 已发布的组件产物——与真实宿主站点完全相同的接入方式，不依赖 widget 源码。
 */
export default function EmbedDemo() {
  useEffect(() => {
    // widget 自行向 body 挂载浮球；重复进入页面时不重复注入
    if (document.getElementById('assistflow-widget-root')) return;
    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.dataset.assistflow = '';
    script.dataset.key = 'd0KX6-CDtI-Gaxc-fR1K';
    script.dataset.name = 'tn_846ad88eee'; // 内置 demo 种子租户的固定 key 与 ID，与服务端 seed 保持一致
    script.dataset.title = 'AssistFlow 客服';
    // 仅在显式配置时覆盖；生产建议把 /api 反代到 widget 同域，避免在嵌入代码暴露 server 域名。
    if (API_BASE) script.dataset.apiBase = API_BASE;
    document.body.appendChild(script);
  }, []);

  return (
    <div className="embed-page">
      <header>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">AF</span>
          <span>演示站点</span>
        </div>
        <a href={WORKSTATION_URL} target="_blank" rel="noopener">打开客服工作台</a>
      </header>

      <main>
        <h1>把客服挂件嵌进这个页面</h1>
        <p className="intro">
          右下角是访客看到的窗口。没有模型 Key 时，回答来自本地 FAQ。访客说出「转人工」之后，会话才进入工作台的接待大厅。
        </p>

        <ol className="steps" aria-label="体验步骤">
          <li>
            <strong>打开右下角窗口</strong>
            <span>和访客在任意网站上打开的是同一个挂件。</span>
          </li>
          <li>
            <strong>问知识库里的问题</strong>
            <span>例如「项目怎么报价」或「最近有档期吗」。</span>
          </li>
          <li>
            <strong>在工作台接手</strong>
            <span>工号 9527，密码 123456。客服发出回复后，自动回答会停下来。</span>
          </li>
        </ol>
      </main>
    </div>
  );
}
