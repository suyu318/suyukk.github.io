---
title: Markdown 扩展功能
published: 2024-05-01
updated: 2024-11-29
description: '了解更多 Mizuki 中的 Markdown 功能'
image: ''
tags: [演示, 示例, Markdown, mizuki]
category: '示例'
draft: false 
---

## GitHub 仓库卡片
您可以添加链接到 GitHub 仓库的动态卡片，页面加载时会从 GitHub API 获取仓库信息。 

::github{repo="matsuzaka-yuki/Mizuki"}

使用代码 `::github{repo="matsuzaka-yuki/Mizuki"}` 创建一个 GitHub 仓库卡片。

```markdown
::github{repo="matsuzaka-yuki/Mizuki"}
```

## 提示框

支持以下类型的提示框：`note`（注意）`tip`（提示）`important`（重要）`warning`（警告）`caution`（警示）

:::note
突出显示用户应该注意的信息，即使是在浏览时。
:::

:::tip
可选信息，帮助用户更成功。
:::

:::important
用户成功所必需的关键信息。
:::

:::warning
由于潜在风险，需要用户立即关注的关键内容。
:::

:::caution
某个操作可能带来的负面后果。
:::

### 基本语法

```markdown
:::note
突出显示用户应该注意的信息，即使是在浏览时。
:::

:::tip
可选信息，帮助用户更成功。
:::
```

### 自定义标题

提示框的标题可以自定义。

:::note[我的自定义标题]
这是一个带有自定义标题的注意框。
:::

```markdown
:::note[我的自定义标题]
这是一个带有自定义标题的注意框。
:::
```

### GitHub 语法

> [!TIP]
> 同样支持 [GitHub 语法](https://github.com/orgs/community/discussions/16925)。

```
> [!NOTE]
> 同样支持 GitHub 语法。

> [!TIP]
> 同样支持 GitHub 语法。
```

### 剧透

您可以为文本添加剧透效果。文本同样支持 **Markdown** 语法。

内容 :spoiler[被隐藏了 **哈哈**]！

```markdown
内容 :spoiler[被隐藏了 **哈哈**]!
