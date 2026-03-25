const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  AlignmentType,
  LevelFormat,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ShadingType,
  PageNumber,
  TableOfContents
} = require("docx");
const fs = require("fs");

// 表格边框样式
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

// 创建表格单元格
function createCell(text, isHeader = false, width = 4680) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: isHeader ? { fill: "E8F4F8", type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: isHeader })]
      })
    ]
  });
}

// 创建代码块段落
function createCodeBlock(lines) {
  return lines.map(
    (line) =>
      new Paragraph({
        shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
        spacing: { before: 0, after: 0 },
        indent: { left: 360 },
        children: [new TextRun({ text: line, font: "Courier New", size: 20 })]
      })
  );
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 24 } } },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "2E75B6" },
        paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 }
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "2E75B6" },
        paragraph: { spacing: { before: 280, after: 180 }, outlineLevel: 1 }
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "404040" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 }
      }
    ]
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          }
        ]
      },
      {
        reference: "numbers",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          }
        ]
      },
      {
        reference: "checklist",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "✅",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          }
        ]
      }
    ]
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "AI提示词培训讲义", size: 20, color: "808080" })]
            })
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "第 ", size: 20 }),
                new TextRun({ children: [PageNumber.CURRENT], size: 20 }),
                new TextRun({ text: " 页", size: 20 })
              ]
            })
          ]
        })
      },
      children: [
        // 标题
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("AI助手进课堂：小学教师提示词入门")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("培训讲义")] }),

        // 一、培训概述
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("一、培训概述")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("培训目标")] }),
        new Paragraph({ children: [new TextRun("通过本次培训，您将：")] }),
        new Paragraph({
          numbering: { reference: "checklist", level: 0 },
          children: [new TextRun("理解AI是什么，消除陌生感")]
        }),
        new Paragraph({
          numbering: { reference: "checklist", level: 0 },
          children: [new TextRun("掌握5个核心提示词技巧")]
        }),
        new Paragraph({
          numbering: { reference: "checklist", level: 0 },
          children: [new TextRun("获得3个可直接使用的提示词模板")]
        }),
        new Paragraph({
          numbering: { reference: "checklist", level: 0 },
          children: [new TextRun("能够独立使用AI辅助备课")]
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("培训流程")] }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [3000, 2000, 4360],
          rows: [
            new TableRow({
              children: [createCell("环节", true, 3000), createCell("时长", true, 2000), createCell("内容", true, 4360)]
            }),
            new TableRow({
              children: [
                createCell("开场：神奇时刻", false, 3000),
                createCell("15分钟", false, 2000),
                createCell("AI是什么 + 现场演示", false, 4360)
              ]
            }),
            new TableRow({
              children: [
                createCell("案例1：生成教案", false, 3000),
                createCell("25分钟", false, 2000),
                createCell("角色设定+任务描述", false, 4360)
              ]
            }),
            new TableRow({
              children: [
                createCell("案例2：设计活动", false, 3000),
                createCell("25分钟", false, 2000),
                createCell("提供示例+迭代优化", false, 4360)
              ]
            }),
            new TableRow({
              children: [
                createCell("案例3：制作课件", false, 3000),
                createCell("25分钟", false, 2000),
                createCell("结构化输出要求", false, 4360)
              ]
            }),
            new TableRow({
              children: [
                createCell("动手练习", false, 3000),
                createCell("20分钟", false, 2000),
                createCell("老师实操+答疑", false, 4360)
              ]
            }),
            new TableRow({
              children: [
                createCell("总结收尾", false, 3000),
                createCell("10分钟", false, 2000),
                createCell("模板发放+学习建议", false, 4360)
              ]
            })
          ]
        }),

        // 二、AI基础知识
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("二、AI基础知识")] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("AI是什么？")] }),
        new Paragraph({ children: [new TextRun("AI（人工智能）就像一个「超级助手」：")] }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("它需要你给它清晰的指令")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("提示词就是给助手的「工作说明」")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("它不会取代老师，但会用提示词的老师效率会高10倍")]
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("推荐AI工具")] }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2500, 3500, 3360],
          rows: [
            new TableRow({
              children: [
                createCell("工具名称", true, 2500),
                createCell("特点", true, 3500),
                createCell("适用场景", true, 3360)
              ]
            }),
            new TableRow({
              children: [
                createCell("Kimi", false, 2500),
                createCell("免费、支持长文本", false, 3500),
                createCell("教案、课件内容生成", false, 3360)
              ]
            }),
            new TableRow({
              children: [
                createCell("文心一言", false, 2500),
                createCell("百度出品、中文优化", false, 3500),
                createCell("各类教学场景", false, 3360)
              ]
            }),
            new TableRow({
              children: [
                createCell("豆包", false, 2500),
                createCell("字节出品、界面友好", false, 3500),
                createCell("新手入门", false, 3360)
              ]
            }),
            new TableRow({
              children: [
                createCell("通义千问", false, 2500),
                createCell("阿里出品、功能全面", false, 3500),
                createCell("各类教学场景", false, 3360)
              ]
            })
          ]
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("使用方式")] }),
        new Paragraph({
          numbering: { reference: "numbers", level: 0 },
          children: [new TextRun("打开AI工具网站或APP")]
        }),
        new Paragraph({
          numbering: { reference: "numbers", level: 0 },
          children: [new TextRun("在对话框中输入提示词")]
        }),
        new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [new TextRun("等待AI生成内容")] }),
        new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [new TextRun("根据需要修改或追问")] }),

        // 三、5个核心提示词技巧
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("三、5个核心提示词技巧")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("技巧1：角色设定")] }),
        new Paragraph({
          children: [
            new TextRun({ text: "原理：", bold: true }),
            new TextRun("告诉AI它是谁，它会以这个身份来思考和回答")
          ]
        }),
        new Paragraph({ children: [new TextRun({ text: "示例：", bold: true })] }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun({ text: "❌ ", color: "FF0000" }), new TextRun("「帮我写一个教案」")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [
            new TextRun({ text: "✅ ", color: "00AA00" }),
            new TextRun("「你是一位有20年经验的小学语文教师，擅长情境教学...」")
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "效果：", bold: true }),
            new TextRun("AI会以资深教师的视角来设计，更符合教学实际")
          ]
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("技巧2：任务描述")] }),
        new Paragraph({
          children: [new TextRun({ text: "原理：", bold: true }), new TextRun("明确告诉AI你要什么，越具体越好")]
        }),
        new Paragraph({ children: [new TextRun({ text: "关键要素：", bold: true })] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("学科、年级")] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("课题名称")] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("课时数量")] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("具体要求")] }),
        new Paragraph({ children: [new TextRun({ text: "示例：", bold: true })] }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun({ text: "❌ ", color: "FF0000" }), new TextRun("「写一个教案」")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [
            new TextRun({ text: "✅ ", color: "00AA00" }),
            new TextRun("「设计一节三年级语文《荷花》第一课时的教案」")
          ]
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("技巧3：提供示例")] }),
        new Paragraph({
          children: [
            new TextRun({ text: "原理：", bold: true }),
            new TextRun("给AI看一个你喜欢的范例，它会模仿这个风格")
          ]
        }),
        new Paragraph({ children: [new TextRun({ text: "示例：", bold: true })] }),
        ...createCodeBlock(["参考风格：我希望活动像「知识抢答赛」那样，", "学生分组竞争，气氛活跃"]),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("技巧4：迭代优化")] }),
        new Paragraph({
          children: [new TextRun({ text: "原理：", bold: true }), new TextRun("第一次生成不满意时，提出具体修改要求")]
        }),
        new Paragraph({ children: [new TextRun({ text: "常用追问方式：", bold: true })] }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("「请把教学目标写得更具体一些」")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("「活动时间太长了，请缩短到10分钟」")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("「请增加一个互动环节」")]
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("技巧5：结构化输出要求")] }),
        new Paragraph({
          children: [new TextRun({ text: "原理：", bold: true }), new TextRun("明确告诉AI你要什么格式")]
        }),
        new Paragraph({ children: [new TextRun({ text: "示例：", bold: true })] }),
        ...createCodeBlock(["请按以下格式输出：", "1. 活动名称", "2. 活动规则", "3. 所需材料", "4. 教师引导语"]),

        // 四、提示词模板
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("四、提示词模板")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("模板1：教案生成")] }),
        ...createCodeBlock([
          "你是一位有20年经验的小学【学科】教师，擅长【教学特色】。",
          "",
          "请帮我设计一节【年级】【学科】课的教案框架：",
          "- 课题：【课题名称】",
          "- 课时：【X】课时",
          "- 教学目标需要包含：知识与技能、过程与方法、情感态度价值观",
          "- 请提供：教学目标、教学重难点、教学过程（含导入、新授、练习、总结）、板书设计"
        ]),
        new Paragraph({ children: [new TextRun({ text: "使用示例：", bold: true })] }),
        ...createCodeBlock([
          "你是一位有20年经验的小学语文教师，擅长情境教学。",
          "",
          "请帮我设计一节三年级语文课的教案框架：",
          "- 课题：《荷花》",
          "- 课时：2课时",
          "- 教学目标需要包含：知识与技能、过程与方法、情感态度价值观",
          "- 请提供：教学目标、教学重难点、教学过程（含导入、新授、练习、总结）、板书设计"
        ]),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("模板2：活动设计")] }),
        ...createCodeBlock([
          "你是一位擅长游戏化教学的小学【学科】教师。",
          "",
          "请帮我设计一个【年级】【课题】的课堂活动：",
          "- 活动时长：【X】分钟",
          "- 活动目标：【具体目标】",
          "- 学生人数：【X】人",
          "",
          "参考风格：我希望活动像【示例描述，如「抢答游戏」「角色扮演」「小组竞赛」】",
          "",
          "请提供：",
          "1. 活动名称",
          "2. 活动规则（学生能听懂的表述）",
          "3. 所需材料",
          "4. 教师引导语"
        ]),
        new Paragraph({ children: [new TextRun({ text: "使用示例：", bold: true })] }),
        ...createCodeBlock([
          "你是一位擅长游戏化教学的小学数学教师。",
          "",
          "请帮我设计一个四年级《分数的初步认识》的课堂活动：",
          "- 活动时长：15分钟",
          "- 活动目标：让学生理解分数的含义",
          "- 学生人数：40人",
          "",
          "参考风格：我希望活动像「小组竞赛」，学生分组动手操作",
          "",
          "请提供：",
          "1. 活动名称",
          "2. 活动规则（学生能听懂的表述）",
          "3. 所需材料",
          "4. 教师引导语"
        ]),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("模板3：课件内容")] }),
        ...createCodeBlock([
          "你是一位擅长制作教学课件的小学【学科】教师。",
          "",
          "请帮我设计一个【年级】【课题】的PPT课件内容大纲：",
          "- 课件页数：约【X】页",
          "- 教学重点：【重点内容】",
          "",
          "请按以下格式输出每一页：",
          "",
          "【第X页】标题：______",
          "- 核心内容（3-5个要点）",
          "- 配图建议",
          "- 讲解提示（教师可以说的话）",
          "",
          "要求：",
          "1. 每页内容不超过5个要点",
          "2. 语言适合小学生理解",
          "3. 包含1-2个互动问题"
        ]),
        new Paragraph({ children: [new TextRun({ text: "使用示例：", bold: true })] }),
        ...createCodeBlock([
          "你是一位擅长制作教学课件的小学科学教师。",
          "",
          "请帮我设计一个五年级《地球的运动》的PPT课件内容大纲：",
          "- 课件页数：约10页",
          "- 教学重点：地球自转和公转的特点",
          "",
          "请按以下格式输出每一页：",
          "",
          "【第X页】标题：______",
          "- 核心内容（3-5个要点）",
          "- 配图建议",
          "- 讲解提示（教师可以说的话）",
          "",
          "要求：",
          "1. 每页内容不超过5个要点",
          "2. 语言适合小学生理解",
          "3. 包含1-2个互动问题"
        ]),

        // 五、常见问题解答
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("五、常见问题解答")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("Q1：AI生成的内容太泛泛，怎么办？")] }),
        new Paragraph({ children: [new TextRun({ text: "原因：", bold: true }), new TextRun("提示词不够具体")] }),
        new Paragraph({ children: [new TextRun({ text: "解决：", bold: true }), new TextRun("补充更多背景信息")] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("添加学生情况描述")] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("说明教学重点难点")] }),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("提供教材版本信息")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("Q2：AI生成的内容太长，怎么办？")] }),
        new Paragraph({
          children: [new TextRun({ text: "解决：", bold: true }), new TextRun("在提示词中添加字数限制")]
        }),
        ...createCodeBlock(["请控制在500字以内", "请生成3个要点即可"]),

        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun("Q3：AI生成的内容不符合教学实际，怎么办？")]
        }),
        new Paragraph({ children: [new TextRun({ text: "解决：", bold: true }), new TextRun("使用迭代优化")] }),
        ...createCodeBlock(["请把导入环节改成游戏形式", "请增加学生互动的环节", "请把语言改得更适合三年级学生"]),

        new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("Q4：不知道用什么AI工具？")] }),
        new Paragraph({ children: [new TextRun({ text: "推荐：", bold: true })] }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("新手入门：豆包（界面友好）")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("教案课件：Kimi（支持长文本）")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("日常使用：文心一言、通义千问")]
        }),

        // 六、后续学习建议
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("六、后续学习建议")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("多用")] }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("每天尝试用AI完成一个小任务")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("从简单任务开始，逐步增加难度")]
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("多改")] }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("对生成结果不满意时，尝试修改提示词")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("记录有效的提示词，形成自己的模板库")]
        }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("多交流")] }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("和同事分享好用的提示词")]
        }),
        new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun("组建学习小组，互相学习")]
        }),

        // 七、结束语
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("七、结束语")] }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 240 },
          children: [
            new TextRun({ text: "AI不会取代老师，但会用AI的老师会更轻松", bold: true, size: 28, color: "2E75B6" })
          ]
        }),
        new Paragraph({ children: [new TextRun("希望各位老师通过本次培训，能够：")] }),
        new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [new TextRun("消除对AI的恐惧感")] }),
        new Paragraph({
          numbering: { reference: "numbers", level: 0 },
          children: [new TextRun("掌握基本的提示词技巧")]
        }),
        new Paragraph({
          numbering: { reference: "numbers", level: 0 },
          children: [new TextRun("在日常备课中尝试使用AI")]
        }),
        new Paragraph({
          spacing: { before: 240 },
          children: [new TextRun({ text: "祝各位老师工作顺利！", bold: true })]
        })
      ]
    }
  ]
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync("docs/training/ai-prompt-training/training-handout.docx", buffer);
  console.log("培训讲义Word文档已创建：docs/training/ai-prompt-training/training-handout.docx");
});
