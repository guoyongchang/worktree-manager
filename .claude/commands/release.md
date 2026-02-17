将当前分支的改动合并到 main 并触发 Release 构建。

执行步骤：
1. 确认当前分支不是 main（如果是则直接跳到第 4 步）
2. 切换到 main 分支，拉取最新代码
3. 合并当前分支到 main（使用 `--no-ff`）
4. 推送 main 到远程
5. 通过 `gh workflow run release.yml --ref main` 触发 Release Build
6. 切换回原来的分支
7. 输出 GitHub Actions 链接，方便查看构建进度
