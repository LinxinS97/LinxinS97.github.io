---
permalink: /
title: ""
excerpt: ""
author_profile: true
redirect_from: 
  - /about/
  - /about.html
---

{% if site.google_scholar_stats_use_cdn %}
{% assign gsDataBaseUrl = "https://cdn.jsdelivr.net/gh/" | append: site.repository | append: "@" %}
{% else %}
{% assign gsDataBaseUrl = "https://raw.githubusercontent.com/" | append: site.repository | append: "/" %}
{% endif %}
{% assign url = gsDataBaseUrl | append: "google-scholar-stats/gs_data_shieldsio.json" %}

<span class='anchor' id='about-me'></span>

I'm a second-year CS Ph.D. student @[University of Southern California](https://www.usc.edu/), advised by Prof. [Jieyu Zhao](https://jyzhao.net/index.html). Before that, I was a M.Eng student at Graduated School of Creative Science and Engineering @[Waseda University (早稲田大学)](https://www.waseda.jp/top/en/), Tokyo, supervised by Prof. [Masayuki Goto](http://www.it.mgmt.waseda.ac.jp/) (Japanese only). I also work closely with [Jieyu Zhang](https://jieyuz2.github.io/), who focuses on interactive and data-centric AI/ML.

**Research Interests**: My research interest lies in the realm of natural language processing and synthetic data. Specifically, I'm trying to answer the following questions:
- How can we comprehensively evaluate an LLM/VLM in different domains?
- How can we extend ability of LLM/VLM with minimal costs?
- How can we let LLM/VLMs collaborate safely, efficiently, and effectively to solve real-world problems?

# 📢 News
\[01/26/2026] [CoAct-1](https://openreview.net/forum?id=l1MQVgIKEU) is accepted to ICLR 2026!

\[08/12/2025] A new preprint is released. Check [CoAct-1: Computer-using Agents with Coding as Actions](https://arxiv.org/abs/2508.03923) for more details!

\[05/20/2025] A new preprint is released. Check [The Hallucination Tax of Reinforcement Finetuning](http://arxiv.org/abs/2505.13988) for more details!

\[04/08/2025\] A new preprint is released. Check [Efficient Reinforcement Finetuning via Adaptive Curriculum Learning](https://arxiv.org/abs/2504.05520) for more details!

\[03/31/2025\] A new preprint is released. Check [Discovering Knowledge Deficiencies of Language Models on Massive Knowledge Base](https://arxiv.org/abs/2503.23361) for more details!

\[04/10/2024\] <span style="color:red">I will join CS@USC as a PhD student this fall!</span>


# 📝 Selected Publications
(\* denotes equal contribution)

### Reinforcement Finetuning
- [The Hallucination Tax of Reinforcement Finetuning](http://arxiv.org/abs/2505.13988)
  <br>**<u>Linxin Song</u>**\*, Taiwei Shi\*, Jieyu Zhao
  <br>*EMNLP 2025 (findings)*
  <br>Covered by: [MarkTechPost](https://www.marktechpost.com/2025/06/05/usc-researchers-introduced-sum-synthetic-unanswerable-math-a-synthetic-dataset-to-reduce-hallucination-in-llms-via-reinforcement-fine-tuning/)
- [Efficient Reinforcement Finetuning via Adaptive Curriculum Learning](https://arxiv.org/abs/2504.05520)
  <br>Taiwei Shi, Yiyang Wu, **<u>Linxin Song</u>**, Tianyi Zhou, Jieyu Zhao

### Agentic AI
- [CoAct-1: Computer-using Agents with Coding as Actions](https://arxiv.org/abs/2508.03923)
  <br>**<u>Linxin Song</u>**, Yutong Dai, Viraj Prabhu, Jieyu Zhang, Taiwei Shi, Li Li, Junnan Li, Silvio Savarese, Zeyuan Chen, Jieyu Zhao, Ran Xu, Caiming Xiong
  <br>*ICLR 2026*.
  <br>Covered by: <span style="color:red">[MarkTechPost](https://www.marktechpost.com/2025/08/07/meet-coact-1-a-novel-multi-agent-system-that-synergistically-combines-gui-based-control-with-direct-programmatic-execution/)</span> | <span style="color:red">[VentureBeat](https://venturebeat.com/ai/salesforces-new-coact-1-agents-dont-just-point-and-click-they-write-code-to-accomplish-tasks-faster-and-with-greater-success-rates/)</span>
- [Adaptive In-conversation Team Building for Language Model Agents](https://arxiv.org/abs/2405.19425)
  <br>**<u>Linxin Song</u>**\*, Jiale Liu\*, Jieyu Zhang, Shaokun Zhang, Ao Luo, Shijian Wang, Qingyun Wu, Chi Wang
  <br>*AIA @COLM 2025*.


### Language Model Evaluation
- [Discovering Knowledge Deficiencies of Language Models on Massive Knowledge Base](https://arxiv.org/abs/2503.23361)
  <br>**<u>Linxin Song</u>**, Xuwei Ding, Jieyu Zhang, Taiwei Shi, Ryotaro Shimizu, Rahul Gupta, Yang Liu, Jian Kang, Jieyu Zhao
  <br>*COLM 2025* | [Webpage](https://maksimstw.github.io/papers/sea)
  <br><audio controls style="height: 30px;"><source src="assets/music/Stochastic Error Ascent.mp3" type="audio/mp3"></audio>
- [Explaining Length Bias in LLM-Based Preference Evaluations](https://arxiv.org/abs/2407.01085#)
  <br>Zhengyu Hu, **<u>Linxin Song</u>**, Jieyu Zhang, Zheyuan Xiao, Jingang Wang, Zhenyu Chen, Hui Xiong
  <br>*EMNLP 2025 (findings)*

### Before PhD
- [Attributed Synthetic Data Generation for Zero-shot Image Classification](https://arxiv.org/abs/2504.04510)
  <br>Shijian Wang, **<u>Linxin Song</u>**, Ryotaro Shimizu, Masayuki Goto, Hanqian Wu
  <br>*ICME 2025 <span style="color:red">(Oral)</span>*
- [Offline Training of Language Model Agents with Functions as Learnable Weights](https://arxiv.org/pdf/2402.11359.pdf)
  <br>Shaokun Zhang\*, Jieyu Zhang\*, Jiale Liu, **<u>Linxin Song</u>**, Chi Wang, Ranjay Krishna, Qingyun Wu
  <br>*ICML 2024*.
  <br>Covered by: <span stype="color:red">[The Forbes Article](https://www.forbes.com/sites/joannechen/2024/05/24/the-promise-of-multi-agent-ai/)<span>
- [ProVision: Programmatically Scaling Vision-centric Instruction Data for Multimodal Language Models](https://arxiv.org/pdf/2412.07012)
  <br>Jieyu Zhang, Le Xue, **<u>Linxin Song</u>**, Jun Wang, Weikai Huang, Manli Shu, An Yan, Zixian Ma, Juan Carlos Niebles, silvio savarese, Caiming Xiong, Zeyuan Chen, Ranjay Krishna, Ran Xu
  <br>Covered by: <span style="color:red">[VentureBeat](https://venturebeat.com/data-infrastructure/breaking-the-data-bottleneck-salesforces-provision-speeds-multimodal-ai-training-with-image-scene-graphs/)</span> | <span style="color:red">[MarkTechPost](https://www.marktechpost.com/2025/01/11/provision-a-scalable-programmatic-approach-to-vision-centric-instruction-data-for-multimodal-language-models/)</span>
- [Better Explain Transformers by Illuminating Important Information](https://arxiv.org/abs/2401.09972)
  <br>**<u>Linxin Song</u>**, Yan Cui, Ao Luo, Freddy Lecue, Irene Li
  <br>*EACL 2024 (findings)*.
- [Investigating the Scaling Effect of Instruction Templates for Training Multimodal Language Model](https://arxiv.org/abs/2412.08307)
  <br>Shijian Wang\*, **<u>Linxin Song</u>**\*, Jieyu Zhang, Ryotaro Shimizu, Ao Luo, Li Yao, Cunjian Chen, Julian McAuley, Haiqian Wu
- [NLPBench: Evaluating Large Language Models on Solving NLP Problems](https://arxiv.org/abs/2309.15630)
  <br>**<u>Linxin Song</u>**, Jieyu Zhang, Lechao Cheng, Pengyuan Zhou, Tianyi Zhou, Irene Li
  <br>*ITIF @ NeurIPS 2023*.
- [Leveraging Instance Features for Label Aggregation in Programmatic Weak Supervision](https://proceedings.mlr.press/v206/zhang23a.html)
  <br>Jieyu Zhang\*, **<u>Linxin Song</u>**\*, Alexander Ratner
  <br>*AISTATS 2023*.
- [Adaptive Ranking-based Sample Selection for Weakly Supervised Class-imbalanced Text Classification](https://aclanthology.org/2022.findings-emnlp.119/)
  <br>**<u>Linxin Song</u>**, Jieyu Zhang, Tianxiang Yang, Masayuki Goto
  <br>*EMNLP 2022 (findings)*.


# 🧑‍🏫 Teaching
- (TA) DSCI-250: Introduction to Data Science, 2024 Fall
- (TA) DSCI-566: Deep Learning and its Applications, 2025 Spring


# 👨‍💻 Internships
- Salesforce Research - Research Intern
  <br> 2025.05-2026.01
- Google
  <br> 2026.02-now


# 🏅 Professional Services
- Maintainer of [AG2 (Autogen)](https://ag2.ai/).
- Reviewer (for multiple years): WACV, KDD, NeurIPS, DMLR, ICLR, AISTATS, ACL, EMNLP, etc
