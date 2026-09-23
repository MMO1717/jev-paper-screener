# Jev Paper Screener (Jev 论文智能初筛系统)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=22.13.0](https://img.shields.io/badge/Node-%3E%3D22.13.0-green.svg)](https://nodejs.org/)
[![Python: >=3.10](https://img.shields.io/badge/Python-%3E%3D3.10-blue.svg)](https://www.python.org/)
[![Model: jev-1.13.0](https://img.shields.io/badge/TypeSafe%20Model-jev--1.13.0-orange.svg)](https://typesafe.ai)

基于 **TypeSafe Jev** 的学术论文智能筛选系统与 AI Agent 技能库。专门解决科研文献调研中的**初筛决策难题**。

---

## 💡 核心设计理念

> **Jev 只打分，不搜索、不编造 related work、不读取全文。**

系统严格恪守以下原则：
1. **真实文献输入**：只对输入的真实论文（标题 + 摘要）进行判定，绝不虚构论文；
2. **规范提取**：缺失摘要的论文归为 `incomplete`（`missing_abstract`），不送 Jev 滥用算力；
3. **分流逻辑由代码固化**：由 3 项硬门槛（Hard Gates）与 4 维加权分严格分流为 **Keep / Review / Drop / Incomplete**，而非依赖 LLM 自由发挥；
4. **定位与角色建议**：给出论文在课题中的推荐使用角色（`method` / `baseline` / `dataset` / `related_work` / `skip`）。

---

## ✨ 核心特性

- **多模式输入**：
  - **批量 PDF 解析**：集成轻量 `unpdf` 解析器，自动去除版权/刊头声明，精准抽取标题与摘要；
  - **批量 URL 抓取**：支持输入多行 arXiv 网页链接或 PDF 直链，并发提取；
  - **结构化文件**：支持导入包含多篇论文的 JSON、CSV、BibTeX；
  - **直接文本**：支持直接粘贴单篇标题与摘要。
- **两轮证据**：第一轮只用标题+摘要；对 Keep/Review 再抽引言和方法覆盖结论。缺段则保持第一轮并标记待审。
- **并行批处理**：多篇论文采用 5 篇并发流水线打分，批量处理 10 篇论文仅需 3 秒左右。
- **现代化可视化看板**：
  - Keep / Review / Drop 三栏直观卡片流；
  - 硬门槛通过/驳回标识（`PASS` / `FAIL`）；
  - 角色定位与置信度（如 95% 置信度将数据集论文标为 `dataset`）；
  - 加权得分与分项维度雷达/细分（问题重叠度、方法复用度、实验迁移度、引用价值）。
- **数据一键导出**：支持将筛选决策与得分明细一键导出为 **CSV** 表格或 **JSON** 报表。
- **双模态开放**：
  - **Web 全功能工作台**：开箱即用，支持桌面端与移动端自适应；
  - **Codex / Agent Global Skill**：可直接集成至 AI 智能体会话工作流中。

---

## 📂 项目结构

```text
jev/
├── paper-screener-site/       # 现代化全栈 Web 工作台 (Next.js / Vite / Tailwind)
│   ├── app/                  # 前端页面、路由与看板界面
│   │   ├── api/screen/       # 论文打分核心 API (支持多文件/多URL/并发打分)
│   │   ├── api/ingest/       # 文档与链接提取 API
│   │   └── screener-workbench.tsx # 交互式工作台组件
│   ├── lib/                  # 核心算法与提取库
│   │   ├── pdf.ts            # PDF 文本抽取与元数据解析
│   │   ├── ingest.ts         # 多格式输入归一化引擎
│   │   ├── score.ts          # TypeSafe Jev API 调用与并行批处理
│   │   └── screener.ts       # 门槛判定、加权评分与路由算法
│   └── package.json
│
├── jev-paper-screener/        # 全局 AI Agent 技能 (OpenAI Codex / Claude 规范)
│   ├── SKILL.md              # 技能定义与调度说明
│   ├── scripts/              # 离线打分、本地服务与测试脚本
│   └── references/           # 评分维度权重、门槛阈值与 Schema 规范
│
└── README.md
```

---

## 🚀 快速开始

### 1. 运行 Web 工作台

```bash
cd paper-screener-site

# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 在 .env 中填入你的 TYPESAFE_API_KEY
echo "TYPESAFE_API_KEY=your_typesafe_key_here" >> .env

# 3. 启动开发服务 (默认监听 5173 端口)
npm run dev

# 4. 构建生产环境
npm run build
```

访问 `http://localhost:5173/` 即可进入工作台。

---

### 2. 作为 Agent Skill 使用

将 `jev-paper-screener` 复制到你的智能体技能目录：

```bash
# 全局安装 (以 Codex 为例)
cp -r jev-paper-screener ~/.codex/skills/

# 配置环境变量
export TYPESAFE_API_KEY="your_typesafe_key_here"
```

在会话中即可通过 `$jev-paper-screener` 直接调用：
```bash
python3 scripts/screen.py --project project.json --candidates papers.json --out runs/latest
```

---

## 📡 REST API 说明

### 1. 筛选打分接口：`POST /api/screen`

**请求体（JSON 或 Multipart Form）**：
```json
{
  "title": "项目标题",
  "brief": "项目详细科学问题描述...",
  "method_constraints": "方法技术约束",
  "evidence_constraints": "评测证据约束",
  "url": "https://arxiv.org/abs/2307.07994\nhttps://arxiv.org/abs/2106.01144",
  "apiKey": "可选的自定义Key（留空使用服务端默认配置）"
}
```

**响应示例**：
```json
{
  "ok": true,
  "model": "jev-1.13.0",
  "counts": { "scored": 2, "incomplete": 0, "keep": 2, "review": 0, "drop": 0 },
  "decisions": [
    {
      "paper": {
        "title": "Facilitating Multi-turn Emotional Support Conversation...",
        "authors": "Jinfeng Zhou; Zhuang Chen; ...",
        "year": "2023",
        "venue": "arXiv",
        "url": "https://arxiv.org/abs/2307.07994"
      },
      "decision": {
        "decision": "keep",
        "reason": "gates_pass_high_score",
        "weighted_score": 0.9887,
        "gates": [
          { "name": "topic_match", "noul": 0.89, "rejected": false },
          { "name": "method_transferable", "noul": 0.94, "rejected": false },
          { "name": "evidence_compatible", "noul": 0.80, "rejected": false }
        ],
        "role": "method"
      }
    }
  ]
}
```

---

## ⚖️ 评分指标与决策逻辑

| 检查阶段 | 评估维度 | 说明 | 决策触发 |
| :--- | :--- | :--- | :--- |
| **硬门槛 (Hard Gates)** | `topic_match` | 研究问题是否属于同一问题族 | 任意硬门槛拒绝且高置信度时直接 **Drop** |
| | `method_transferable` | 核心方法/策略是否可迁移复用 | 硬门槛存疑或边际低分时进入 **Review** |
| | `evidence_compatible` | 数据形态/评测标准是否同质兼容 | |
| **加权分 (Scores)** | `problem_overlap` (35%) | 核心科学问题重叠度 | 加权分 $\ge 62\%$ 且门槛全过进入 **Keep** |
| | `method_reuse` (30%) | 算法与架构可借鉴程度 | 加权分 $\le 38\%$ 直接进入 **Drop** |
| | `experiment_transfer` (20%) | 实验配置与评测协议迁移度 | |
| | `citation_value` (15%) | 论文作为背景/定位引用的价值 | |

---

## 📜 许可证与免责声明

本项目基于 [MIT License](LICENSE) 开源。

> **免责声明**：本系统的打分和分流结果仅供学术文献初筛辅助参考，不可替代科研人员对论文正文的独立阅读与正式相关工作论证。
