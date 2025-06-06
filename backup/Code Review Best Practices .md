Kevin London在其文章[《Code Review Best Practices》](https://www.kevinlondon.com/2015/05/05/code-review-best-practices)中分享了进行代码审查的最佳实践，这些实践适用于软件开发团队，旨在提高代码质量和团队协作。

以下是文章中的主要观点：
- 职责单一原则（Single Responsibility Principle）: 一个类或方法应该只负责一项功能。如果描述一个方法的功能需要使用“并且”，这可能意味着方法的职责范围过广，应该考虑分解。
- 开放封闭原则（Open/Closed Principle）: 如果使用面向对象编程，确保对象易于扩展但不易修改。当需要增加新特性时，代码应该可以通过添加新代码来实现，而不是修改已有代码。
- 代码重复（Code Duplication）: 采用“三次触碰”规则。如果代码被复制了一次，通常可以容忍，但如果再次复制，应该重构代码，将重复的逻辑抽象出来。
- 眯眼测试（Squint Test）: 检查代码的布局和结构是否一致，是否存在可能指示代码结构问题的模式。
-  留下更好的代码（Code Left in a Better State）: 当修改混乱的代码区域时，应该努力让代码比原来更好。
- 潜在的bug: 检查是否有可能的off-by-one错误，循环是否能按照预期终止，以及是否会无限循环。
- 错误处理: 错误是否被优雅地处理，必要时是否明确地处理，是否添加了自定义错误，这些错误是否有用。
- 效率: 算法是否使用了高效的实现，例如，遍历字典的键列表来查找一个值是低效的。
- 命名规范: 方法和变量的命名是否准确反映了其功能，避免使用模糊或不具描述性的名称。
-  函数长度: 函数长度是否适中，避免过长的函数，以提高代码的可读性和维护性。
-  代码审查前的自我检查: 在提交代码审查前，作者应该先自我检查，如检查是否有遗留的注释或TODO标记，变量命名是否合理，以及其他在上述列出的事项。
-  人性化沟通: 代码审查不仅仅是技术评估，还涉及到人际交流。建议的方法包括提问、表扬、面对面讨论复杂点、解释建议的理由、聚焦于代码而非个人、区分建议的优先级等。
-  保持开放心态: 在代码审查中保持开放和非防御性的态度，理解审查的目的在于改进代码质量，而不是个人批评。
通过遵循这些最佳实践，软件团队可以提升代码的质量、可维护性和团队协作效率。

![xBitBetter公众号](https://goohugo.github.io/xbitbetter.png "xBitBetter公众号")

<!-- ##{"timestamp":1748323389}## -->