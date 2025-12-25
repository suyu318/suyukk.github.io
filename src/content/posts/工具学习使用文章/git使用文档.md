---
title: Git 常用命令速查笔记
published: 2025-12-25
description: 一份清晰、实用的日常开发参考指南，涵盖从初始配置到团队协作的所有关键环节
tags: [Git, 版本控制, 开发工具]
category: 开发工具
licenseName: "Unlicensed"
author: ""
sourceLink: ""
draft: false
---

# Git 常用命令速查笔记

一份清晰、实用的日常开发参考指南，涵盖从初始配置到团队协作的所有关键环节

## 核心优势

- 结构化组织，快速掌握 Git 核心概念
- 详细的命令解释和最佳实践建议
- 适用于个人项目和团队协作场景

## 目录

- [配置与初始化](#配置与初始化)
- [核心工作流](#核心工作流本地操作)
- [分支管理](#分支管理)
- [远程仓库协作](#远程仓库协作)
- [历史记录与比较](#历史记录与比较)
- [撤销与恢复](#撤销与恢复)
- [标签与里程碑](#标签与里程碑)

## 配置与初始化

在使用 Git 进行版本控制之前，首要步骤是进行正确的配置和初始化。这一阶段是后续所有操作的基础，确保了代码提交的身份标识和仓库的正确建立。

### 全局配置

```bash
git config --global user.name "Your Name"
git config --global user.email "youremail@example.com"
```

设置用户名和邮箱是 Git 提交的必要身份标识

```bash
git config --global color.ui true
```

启用命令行颜色高亮，提升可读性

### 仓库初始化

```bash
git init
```

在本地目录创建新的 Git 仓库

```bash
git clone <repository-url>
```

克隆远程仓库到本地

> [!TIP]
> 使用 `git config --list` 查看所有配置。遇到不熟悉的命令时，使用 `git help <command>` 获取详细帮助。

## 核心工作流：本地操作

Git 的日常使用围绕着工作区、暂存区和本地仓库三者之间的交互展开。"修改-暂存-提交"的循环构成了版本控制的基础流程。

![Git工作区、暂存区、仓库关系图](https://kimi-web-img.moonshot.cn/img/www.hsuyeung.com/9f2796598601f7129e06508237ddc6f4f99768df.png)

### 检查状态

```bash
git status
```

显示工作区和暂存区的状态，包括已修改、已暂存和未跟踪的文件

### 暂存更改

```bash
git add .
```

将所有修改和新增文件添加到暂存区。可以使用 `git reset HEAD <file>` 取消暂存

### 提交更改

```bash
git commit -m "message"
```

将暂存区的内容提交到本地仓库。使用 `-a` 参数可跳过暂存直接提交已跟踪文件的修改

> [!NOTE]
> 文件操作命令
>
> ```bash
>git mv <old> <new>
>```
>
> 重命名文件并自动暂存
>
> ```bash
>git rm <file>
>```
>
> 从仓库中删除文件

## 分支管理

分支是 Git 最强大的特性之一，它允许开发者在不影响主代码线的情况下进行独立的开发、实验或修复工作。高效的分支管理是现代软件开发流程的基石。

### 分支操作

```bash
git branch
```

列出所有本地分支，当前分支标有星号

```bash
git checkout -b <branchname>
```

创建并切换到新分支

```bash
git merge <branchname>
```

将指定分支合并到当前分支

### 分支清理

```bash
git branch -d <branchname>
```

删除已合并的本地分支

```bash
git push origin :<branchname>
```

删除远程分支

> [!WARNING]
> 合并冲突处理
>
> 当两个分支修改了同一文件的相同部分时，Git 无法自动合并，会产生合并冲突。
>
> 1. 手动编辑冲突文件，选择保留的更改
> 2. 使用 `git add` 标记冲突已解决
> 3. 执行 `git commit` 完成合并

## 远程仓库协作

Git 的分布式特性使得多人协作变得异常高效。远程仓库是协作的中心枢纽，通常托管在 GitHub、GitLab 或 Bitbucket 等代码托管平台上。

### 远程管理

```bash
git remote -v
```

查看已关联的远程仓库及其 URL

### 推送更改

```bash
git push origin <branchname>
```

将本地分支推送到远程仓库。使用 `-u` 参数建立追踪关系

### 获取更新

```bash
git pull
```

获取远程更新并合并到当前分支。`git fetch` 仅获取不合并

> [!NOTE]
> 团队协作流程建议
>
> 1. 获取最新更新
> ```bash
>git pull origin main
>```
>
> 2. 创建功能分支
> ```bash
>git checkout -b feature-x
>```
>
> 3. 开发并提交
> ```bash
>git add . && git commit -m "feat: add feature x"
>```
>
> 4. 推送到远程
> ```bash
>git push -u origin feature-x
>```

## 历史记录与比较

Git 的核心价值之一在于其强大的历史记录管理能力。开发者可以随时查看项目的演进历史，比较不同版本之间的差异，甚至回退到任何一个历史状态。

### 查看历史

```bash
git log --oneline --graph
```

简洁的日志图，直观展示分支结构

```bash
git log --stat
```

显示每个提交的文件修改统计

### 比较差异

```bash
git diff
```

比较工作区与暂存区的差异

```bash
git diff --staged
```

比较暂存区与最新提交的差异

> [!NOTE]
> 历史记录搜索
>
> ```bash
> git grep "search-term"
> ```
>
> 在整个代码库中搜索文本，支持正则表达式。使用 `--all` 搜索所有分支和标签

## 撤销与恢复

Git 提供了强大的撤销和恢复机制，帮助开发者安全地回退到之前的状态。这些操作主要涉及对工作区、暂存区和提交历史的修改进行撤销。

### 撤销工作区修改

```bash
git checkout -- <filename>
```

丢弃工作区的更改，恢复到最近一次提交。此操作不可逆，需谨慎使用

### 重置提交

```bash
git reset --soft HEAD~1
```

软重置到上一个提交，保留更改在暂存区。使用 `--hard` 进行硬重置

### 暂存工作

```bash
git stash
```

暂存当前工作，使工作区恢复干净状态。使用 `git stash pop` 恢复

> [!WARNING]
> 危险操作警告
>
> - `git reset --hard` 会永久删除未提交的更改和历史记录，使用前请确保已备份重要工作
> - `git checkout --` 会永久丢弃工作区修改，无法恢复

## 标签与里程碑

标签是 Git 中用于标记特定提交的静态引用，通常用于标记版本发布点（如 v1.0.0），方便日后快速定位和回溯到这些重要的历史节点。

### 创建标签

```bash
git tag -a v1.0.0 -m "Release message"
```

创建附注标签，包含完整信息

```bash
git tag v1.0
```

创建轻量标签，仅作为提交引用

### 推送标签

```bash
git push origin v1.0.0
```

推送单个标签到远程

```bash
git push origin --tags
```

推送所有本地标签到远程

> [!TIP]
> 标签使用建议
>
> - 使用语义化版本号（如 v1.0.0, v2.1.3）
> - 为每个正式发布版本创建附注标签
> - 在标签信息中包含版本说明和变更日志
> - 使用 `git show <tagname>` 查看标签详情

## 总结

这份 Git 常用命令速查笔记涵盖了日常开发中的核心操作，从基础配置到高级协作，从本地工作流到团队协同。掌握这些命令将帮助你更高效地进行版本控制和团队协作。

持续学习，不断实践

*Happy Coding*