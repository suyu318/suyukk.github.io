---
title: CentOS 7 安装 Docker
published: 2025-12-24
description: 在 CentOS 7 系统上安装 Docker 的详细步骤指南，包括依赖安装、配置镜像源等。
tags: [Docker, CentOS, 安装, Linux]
category: 学习笔记
licenseName: "Unlicensed"
author: 素鱼
sourceLink: ""
draft: false
---

# CentOS 7 安装 Docker

## 1. 安装依赖

```bash
yum update -y
sudo yum install -y yum-utils device-mapper-persistent-data lvm2
```

## 2. 配置yum下载源

```bash
sudo yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
```

## 3. 直接安装

```bash
sudo yum -y install docker-ce docker-ce-cli containerd.io
```


## 4. 启动和配置 Docker 服务

### 4.1. 启动 Docker 服务

```bash
sudo systemctl start docker
```

### 4.2. 设置开机自启

```bash
sudo systemctl enable docker
```

### 4.3. 查看运行状态

```bash
sudo systemctl status docker
```

### 4.4. 查看版本（客户端+服务端）

```bash
docker version
```

### 4.5. 加入docker 组

```bash
sudo usermod -aG docker $USER
newgrp docker
```      


## 5. 配置镜像源

### 5.1. 创建配置目录

```bash
sudo mkdir -p /etc/docker        
```

### 5.2. 写入镜像源

```bash
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.imgdb.de",
    "https://docker-0.unsee.tech",
    "https://docker.hlmirror.com",
    "https://docker.1ms.run",
    "https://func.ink",
    "https://lispy.org",
    "https://docker.xiaogenban1993.com"
  ]
}
EOF

sudo systemctl restart docker
```

## 6. 验证安装

```bash
docker info | grep -A2 Registry
```