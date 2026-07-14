---
title: Button 按钮
description: 用于触发一个操作的基础组件文档。
order: 1
icon: mouse-pointer-2
---

# Button 按钮

按钮用于触发明确的用户操作。优先使用简短、具体的动词作为按钮文案。

## 基础用法

```tsx
import { Button } from '@lumos-ui/react';

<Button theme="solid">保存更改</Button>
```

## 变体

| 变体 | 使用场景 |
| --- | --- |
| Solid | 页面中的主要操作 |
| Outline | 次要操作或并列操作 |
| Text | 低优先级操作 |

更多组件可以继续放入 `docs/components/`，目录会自动生成导航层级。
