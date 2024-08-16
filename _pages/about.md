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

I'm a CS Ph.D. student @[USC](https://www.usc.edu/), advised by Prof. [Jieyu Zhao](https://jyzhao.net/index.html). Before that, I was a M.Eng student at Graduated School of Creative Science and Engineering @[Waseda University (早稲田大学)](https://www.waseda.jp/top/en/), Tokyo, supervised by Prof. [Masayuki Goto](http://www.it.mgmt.waseda.ac.jp/) (Japanese only). I also spent my time as a research assistant @[UMD](https://www.umd.edu/), advised by Prof.[Tianyi Zhou](https://tianyizhou.github.io/), and [University of Tokyo (東京大学)](https://www.u-tokyo.ac.jp/en/), advised by Prof.[Irene Li](https://ireneli.eu/). I also work closely with [Jieyu Zhang](https://jieyuz2.github.io/), who focuses on interactive and data-centric AI/ML.

**Research Interests**: My research interest lies in the realm of Natural Language Processing. Specifically, I'm trying to answer the following questions:
- How can we comprehensively evaluate an LLM in different domains?
- How can we extend LLMs' ability with minimal costs?
- How can we let LLMs collaborate safely, efficiently, and effectively to solve real-world problems?

# 📢 News
\[05/31/2024\] A new preprint is released. Check [Adaptive In-conversation Team Building for Language Model Agents](https://arxiv.org/abs/2405.19425) for more details!

\[04/10/2024\] <span style="color:red">I will join CS@USC as a PhD student this fall!</span>

\[11/26/2023\] I completed my first feature contribution to [AutoGen](https://github.com/microsoft/autogen)! Check the [AutoBuild's blog](https://microsoft.github.io/autogen/blog/2023/11/26/Agent-AutoBuild/) for more details.


# 📝 Selected Publications
(\* denotes equal contribution)

### Preprint
- [Rethinking LLM-based Preference Evaluation](https://arxiv.org/abs/2407.01085#)
  <br>Zhengyu Hu, **<u>Linxin Song</u>**, Jieyu Zhang, Zheyuan Xiao, Jingang Wang, Zhenyu Chen, Hui Xiong
- [Adaptive In-conversation Team Building for Language Model Agents](https://arxiv.org/abs/2405.19425)
  <br>**<u>Linxin Song</u>**\*, Jiale Liu\*, Jieyu Zhang, Shaokun Zhang, Ao Luo, Shijian Wang, Qingyun Wu, Chi Wang

### Peer-reviewed
- [Offline Training of Language Model Agents with Functions as Learnable Weights](https://arxiv.org/pdf/2402.11359.pdf)
  <br>Shaokun Zhang\*, Jieyu Zhang\*, Jiale Liu, **<u>Linxin Song</u>**, Chi Wang, Ranjay Krishna, Qingyun Wu
  <br>*ICML 2024*.
- [Better Explain Transformers by Illuminating Important Information](https://arxiv.org/abs/2401.09972)
  <br>**<u>Linxin Song</u>**, Yan Cui, Ao Luo, Freddy Lecue, Irene Li
  <br>*EACL 2024 (findings)*.
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


# 👨‍💻 Internships
- University of Tokyo - Research Assistant
  <br>2023.02-2024.02
  <br>Advised by [Irene Li](https://ireneli.eu/)
- University of Maryland, College Park - Research Assistant
  <br>2022.07-2023.10
  <br>Advised by [Tianyi Zhou](https://tianyizhou.github.io/)
- University of Washington - Research Intern
  <br>2022.03-2022.11
  <br>Advised by [Alex Ratner](https://ajratner.github.io/) and [Jieyu Zhang](https://jieyuz2.github.io/)


# 🏅 Professional Services
- Reviewer: WACV 2023, ECML-PKDD 2023, NeurIPS 2023, DMLR 2023, ICLR 2024, AISTATS 2024, ACL 2024 (ARR Feb), NeurIPS 2024, EMNLP 2024 (ARR June), ICLR 2025, KDD 2025
