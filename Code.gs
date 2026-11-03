
/**
 * AI LESSON PLANNER BY TAIWO
 * Holy Child College, Ikoyi, Lagos
 *
 * REQUIRED SCRIPT PROPERTY:
 * GEMINI_API_KEY = your Gemini API key
 *
 * SECURITY:
 * - Never place the API key in Index.html.
 * - Do not log the API key or send it to the browser.
 * - Continuation requests are made only when a response is cut off.
 * - Request IDs, cache and locks help prevent duplicate requests.
 * - Temporary Word documents are moved to Trash after export.
 */


/* =========================================================
   1. APPLICATION CONFIGURATION
   ========================================================= */

const APP_CONFIG = {
  APP_TITLE: 'AI Lesson Planner by TAIWO',
  SCHOOL_SLOGAN: 'FACTA, NON VERBA',

  GEMINI_MODEL: 'gemini-3.8-flash',
  GEMINI_API_BASE:
    'https://generativelanguage.googleapis.com/v1beta/models/',

  // OpenRouter chat-completions endpoint and free-model router.
  OPENROUTER_API_URL: 'https://openrouter.ai/api/v1/chat/completions',
  OPENROUTER_FREE_MODEL: 'openrouter/free',

  REQUEST_CACHE_SECONDS: 600,
  MAX_TOPIC_LENGTH: 500,
  MAX_OBJECTIVES_LENGTH: 4000,
  MAX_REQUEST_ID_LENGTH: 120,
  MAX_OUTPUT_TOKENS: 8192,
  MAX_CONTINUATION_CALLS: 3,
  MAX_PLAN_LENGTH: 100000,

  FONT: 'Arial',

  WINE: '#6B1839',
  DARK_WINE: '#481027',
  CREAM: '#F4E9EE',
  LIGHT_CREAM: '#FBF7F8',
  DARK_TEXT: '#222222',
  MUTED_TEXT: '#666666',
  WHITE: '#FFFFFF',
  TABLE_BORDER: '#B7A0AA'
};


/* =========================================================
   2. OPEN THE WEB APP
   ========================================================= */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


/* =========================================================
   3. GENERATE A LESSON PLAN
   ========================================================= */

function generateLessonPlan(formData) {
  validateFormData_(formData);

  const data = normalizeFormData_(formData);
  const provider = data.aiProvider || 'gemini';
  const keyProperty = provider === 'openrouter'
    ? 'OPENROUTER_API_KEY'
    : 'GEMINI_API_KEY';

  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty(keyProperty);

  if (!apiKey) {
    throw new Error(
      'The API key for ' +
      (provider === 'openrouter' ? 'OpenRouter' : 'Gemini') +
      ' is missing. Add ' + keyProperty +
      ' under Project Settings > Script Properties.'
    );
  }

  const requestId = data.requestId;

  /*
   * Cache successful results by request ID and provider.
   * A lock reduces the chance of duplicate simultaneous requests.
   */
  const cache = CacheService.getScriptCache();
  const cacheKey = buildRequestCacheKey_(requestId + ':' + provider);
  const cached = cache.get(cacheKey);

  if (cached) {
    try {
      const saved = JSON.parse(cached);
      if (saved && saved.plan) return saved.plan;
    } catch (ignored) {
      // Invalid cache entries are ignored.
    }
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error(
      'Another request is being processed. Please wait a moment ' +
      'and submit again.'
    );
  }

  try {
    const secondCached = cache.get(cacheKey);
    if (secondCached) {
      try {
        const savedAgain = JSON.parse(secondCached);
        if (savedAgain && savedAgain.plan) return savedAgain.plan;
      } catch (ignored) {
        // Continue if the cache entry is invalid.
      }
    }

    const prompt = buildLessonPrompt_(data);
    const plan = generateWithContinuation_(provider, apiKey, prompt);

    if (!plan || !String(plan).trim()) {
      throw new Error('The selected AI provider returned an empty lesson plan.');
    }

    const cleanPlan = cleanText_(plan);

    validateFinalOutput_(cleanPlan);
    validateGeneratedPlan_(data, cleanPlan);
    validateRequestedQuestionSets_(data, cleanPlan);
    try {
      cache.put(
        cacheKey,
        JSON.stringify({ plan: cleanPlan }),
        APP_CONFIG.REQUEST_CACHE_SECONDS
      );
    } catch (cacheError) {
      console.warn('Could not cache the lesson plan.');
    }

    return cleanPlan;
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
   4. VALIDATE THE FORM
   ========================================================= */

function validateFormData_(formData) {
  if (!formData || typeof formData !== 'object' ||
      Array.isArray(formData)) {
    throw new Error('Please complete the lesson-plan form.');
  }

  const school = getFormValue_(formData, [
    'school', 'schoolName'
  ]);

  const className = getFormValue_(formData, [
    'classLevel', 'class', 'className', 'studentClass'
  ]);

  const subject = getFormValue_(formData, [
    'subject', 'subjectName'
  ]);

  const topic = getFormValue_(formData, [
    'topic', 'lessonTopic'
  ]);

  const duration = getFormValue_(formData, [
    'duration', 'lessonDuration'
  ]);

  const objectiveMode =
    getFormValue_(formData, ['objectiveMode']) || 'ai';

  const aiProvider =
    getFormValue_(formData, ['aiProvider']) || 'gemini';

  if (aiProvider !== 'gemini' && aiProvider !== 'openrouter') {
    throw new Error('Please select a supported AI provider.');
  }

  const objectives = getFormValue_(formData, [
    'learningObjectives'
  ]);

  if (!school) {
    throw new Error('Please enter the school name.');
  }

  if (!className) {
    throw new Error('Please enter the class.');
  }

  if (!subject) {
    throw new Error('Please select or enter a subject.');
  }

  if (!topic) {
    throw new Error('Please enter the lesson topic.');
  }

  if (topic.length > APP_CONFIG.MAX_TOPIC_LENGTH) {
    throw new Error(
      'The lesson topic is too long. Please shorten it to ' +
      APP_CONFIG.MAX_TOPIC_LENGTH + ' characters or fewer.'
    );
  }

  if (!duration) {
    throw new Error('Please select the lesson duration.');
  }

  if (
    objectiveMode !== 'ai' &&
    objectiveMode !== 'teacher'
  ) {
    throw new Error(
      'Please select AI-generated or teacher-provided objectives.'
    );
  }

  if (objectiveMode === 'teacher' && !objectives) {
    throw new Error(
      'Please enter your learning objectives or select the AI option.'
    );
  }

  if (objectives.length > APP_CONFIG.MAX_OBJECTIVES_LENGTH) {
    throw new Error(
      'The learning objectives are too long. Please shorten them.'
    );
  }

  const rawMethods = Array.isArray(formData.teachingMethods)
    ? formData.teachingMethods
    : [];

  const oldMethod = getFormValue_(formData, [
    'method', 'teachingMethod', 'methodology'
  ]);

  const methods = rawMethods
    .map(function(value) {
      return String(value || '').trim();
    })
    .filter(function(value, index, all) {
      return value !== '' && all.indexOf(value) === index;
    });

  if (methods.length > 2) {
    throw new Error('Please select no more than two teaching methods.');
  }

  const allowedQuestionTypes = [
    'theory', 'subjective', 'objective'
  ];

  if (
    formData.questionTypes !== undefined &&
    !Array.isArray(formData.questionTypes)
  ) {
    throw new Error('The selected question types are invalid.');
  }

  const questionTypes = Array.isArray(formData.questionTypes)
    ? formData.questionTypes
    : [];

  questionTypes.forEach(function(value) {
    if (
      allowedQuestionTypes.indexOf(
        String(value || '').trim().toLowerCase()
      ) === -1
    ) {
      throw new Error('An unsupported question type was selected.');
    }
  });

  const requestId = getFormValue_(formData, ['requestId']);

if (requestId.length > APP_CONFIG.MAX_REQUEST_ID_LENGTH) {
  throw new Error('The request ID is invalid.');
}

// Validate curriculum selection
const allowedCurricula = [
  'nigerian_general',
  'bece',
  'wassce_neco',
  'jamb_utme',
  'teacher_syllabus'
];

const curriculum =
  String(formData.curriculum || 'nigerian_general').trim();

if (allowedCurricula.indexOf(curriculum) === -1) {
  throw new Error('Please select a valid curriculum option.');
}

// Validate teacher-provided curriculum requirements
const curriculumRequirements =
  String(formData.curriculumRequirements || '').trim();

if (curriculum === 'teacher_syllabus' && !curriculumRequirements) {
  throw new Error(
    'Please enter the teacher-provided curriculum requirements.'
  );
}

if (curriculumRequirements.length > 4000) {
  throw new Error(
    'Curriculum requirements must not exceed 4,000 characters.'
  );
}
}

/* =========================================================
   5. NORMALIZE THE FORM DATA
   ========================================================= */

function normalizeFormData_(formData) {
  const school = getFormValue_(formData, [
    'school', 'schoolName'
  ]) || 'Holy Child College, Ikoyi, Lagos';

  const className = getFormValue_(formData, [
    'classLevel', 'class', 'className', 'studentClass'
  ]) || 'SS1';

  const subject = getFormValue_(formData, [
    'subject', 'subjectName'
  ]);

  const topic = getFormValue_(formData, [
    'topic', 'lessonTopic'
  ]);

  const duration = getFormValue_(formData, [
    'duration', 'lessonDuration'
  ]) || '40 minutes';

  const methodsFromArray = Array.isArray(formData.teachingMethods)
    ? formData.teachingMethods
    : [];

  const selectedMethods = methodsFromArray
    .map(function(value) {
      return String(value || '').trim();
    })
    .filter(function(value, index, all) {
      return value !== '' && all.indexOf(value) === index;
    });

  const oldMethod = getFormValue_(formData, [
    'method', 'teachingMethod', 'methodology'
  ]);

  if (selectedMethods.length === 0 && oldMethod) {
    selectedMethods.push(oldMethod);
  }

  const objectiveMode =
    getFormValue_(formData, ['objectiveMode']) || 'ai';

  const aiProvider =
    getFormValue_(formData, ['aiProvider']) || 'gemini';

  const teacherObjectives = getFormValue_(formData, [
    'learningObjectives'
  ]);
const curriculum =
  getFormValue_(formData, ['curriculum']) || 'nigerian_general';

const curriculumRequirements =
  getFormValue_(formData, ['curriculumRequirements']);
  const rawQuestionTypes = Array.isArray(formData.questionTypes)
    ? formData.questionTypes
    : [];

  const allowedQuestionTypes = [
    'theory', 'subjective', 'objective'
  ];

  const questionTypes = rawQuestionTypes
    .map(function(value) {
      return String(value || '').trim().toLowerCase();
    })
    .filter(function(value, index, all) {
      return allowedQuestionTypes.indexOf(value) !== -1 &&
        all.indexOf(value) === index;
    });

  /*
   * The browser should supply a unique requestId for each new
   * generation attempt. A fallback is supplied for older interfaces.
   */
  const requestId = getFormValue_(formData, ['requestId']) ||
    Utilities.getUuid();

  return {
  school: school,
  className: className,
  subject: subject,
  topic: topic,
  duration: duration,
  selectedMethods: selectedMethods,
  objectiveMode: objectiveMode,
  teacherObjectives: teacherObjectives,
  curriculum: curriculum,
  curriculumRequirements: curriculumRequirements,
  aiProvider: aiProvider,
  questionTypes: questionTypes,
  requestId: requestId
};
}


/* =========================================================
   6. BUILD THE LESSON-PLAN PROMPT
   ========================================================= */

function buildLessonPrompt_(data) {
  const normalizedClass = data.className
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/YEAR/g, '');

  const isJss = /^JSS[123]$/.test(normalizedClass);
  const isSs = /^SS[123]$/.test(normalizedClass);

  let examinationGuidance;

  if (isJss) {
    examinationGuidance = `
EXAMINATION STYLE

This is a junior secondary class. Any optional examination questions
must suit the Nigerian junior secondary curriculum and the style and
difficulty associated with NECO BECE and Lagos State BECE.

Do not use senior secondary or JAMB-level content for this class.
`;
  } else if (isSs) {
    examinationGuidance = `
EXAMINATION STYLE

This is a senior secondary class. Optional examination questions
should suit the Nigerian senior secondary curriculum and the style
of WASSCE, GCE and NECO SSCE. JAMB UTME-style questions may be used
where appropriate to the topic and class.

Do not introduce advanced content without labelling it extension work.
`;
  } else {
    examinationGuidance = `
EXAMINATION STYLE

The class is "${data.className}". Determine an appropriate Nigerian
school level from the class name and use suitable question difficulty.
For junior secondary classes, use NECO BECE and Lagos State BECE style.
For senior secondary classes, use WASSCE, GCE, NECO SSCE and, where
appropriate, JAMB UTME style.
`;
  }

  let questionInstructions = '';

  if (data.questionTypes.length === 0) {
    questionInstructions = `
OPTIONAL EXAMINATION QUESTIONS

The teacher has not selected any additional question sets.
Do not generate optional theory, subjective or objective question sets.
Keep the normal lesson evaluation and assignment sections.
`;
  } else {
    const sets = [];

    let questionSetNumber = 0;

    if (data.questionTypes.indexOf('theory') !== -1) {
      questionSetNumber++;
      sets.push(`
${questionSetNumber}. THEORY QUESTIONS — EXACTLY 5
- Give exactly five theory or essay questions.
- Do not provide answers, hints, marking schemes or model solutions
  for these five theory questions.
- Make every question clear and suitable for the class.
`);
    }

    if (data.questionTypes.indexOf('subjective') !== -1) {
      questionSetNumber++;
      sets.push(`
${questionSetNumber}. SUBJECTIVE QUESTIONS — EXACTLY 10 WITH ANSWERS
- Give exactly ten short-answer or structured-response questions.
- Do not provide multiple-choice options.
- Place a correct answer or expected response after each question.
- Show sufficient working for calculations.
`);
    }

    if (data.questionTypes.indexOf('objective') !== -1) {
      questionSetNumber++;
      sets.push(`
${questionSetNumber}. OBJECTIVE QUESTIONS — EXACTLY 10 WITH OPTIONS AND ANSWERS
- Give exactly ten multiple-choice questions.
- Provide four options labelled A, B, C and D for each question.
- Only one option should be correct.
- Clearly identify the correct answer after each question.
- Check the accuracy of all options and answers.
`);
    }

    questionInstructions = `
ADDITIONAL EXAMINATION PRACTICE QUESTIONS

MANDATORY OUTPUT CONTRACT — DO NOT OMIT SELECTED QUESTION SETS
The teacher selected these question types in the form. Every selected
set is REQUIRED and must appear in the final response. Do not treat these
sets as optional, do not replace them with the ordinary lesson evaluation
or assignment, and do not stop after the main lesson plan.

Put the selected sets after the main lesson plan under the exact heading:
"ADDITIONAL EXAMINATION PRACTICE QUESTIONS".
Reserve sufficient output space for the complete lesson AND every selected
question set. If the response reaches its output limit, continue until all
selected sets are complete and then print [[LESSON_PLAN_COMPLETE]]. Never
print the completion marker while a selected set is missing or unfinished.

${sets.join('\n')}

${examinationGuidance}

AUTHENTICITY AND ACCURACY
- Do not claim generated questions are authentic past questions
  unless their exact source has been supplied or verified.
- Otherwise label them as original past-question-style practice.
- Do not invent examination years, paper codes or citations.
- Keep all questions relevant to the subject, topic and class.
- Number each selected set independently.
- Do not reduce the exact number of requested questions.
`;
  }
let curriculumInstruction = '';

switch (data.curriculum) {
  case 'bece':
    curriculumInstruction = `
CURRICULUM ALIGNMENT: BECE
Prepare this lesson for the Nigerian Junior Secondary School level.
Use appropriate JSS learning outcomes and BECE-style expectations.
Do not introduce Senior Secondary School content unnecessarily.
`;
    break;

  case 'wassce_neco':
    curriculumInstruction = `
CURRICULUM ALIGNMENT: WASSCE / NECO SSCE
Align the lesson with the appropriate Nigerian Senior Secondary School
level and relevant WASSCE / NECO SSCE learning expectations.
Use examination-appropriate terminology and depth.
`;
    break;

  case 'jamb_utme':
    curriculumInstruction = `
CURRICULUM ALIGNMENT: JAMB UTME
Emphasise conceptual understanding, application and objective-question
reasoning appropriate to the subject and topic.
Do not introduce content outside the relevant subject scope.
`;
    break;

  case 'teacher_syllabus':
    curriculumInstruction = `
TEACHER-PROVIDED CURRICULUM REQUIREMENTS

Use the following requirements as the primary curriculum guidance:

${data.curriculumRequirements}

Follow the supplied requirements closely. Do not invent additional
syllabus requirements or claim that they have been independently verified.
`;
    break;

  default:
    curriculumInstruction = `
CURRICULUM ALIGNMENT: GENERAL NIGERIAN SECONDARY SCHOOL
Use the appropriate Nigerian secondary-school curriculum level for
the specified class, subject and topic. Distinguish general guidance
from verified syllabus requirements.
`;
}
  const accountingAccuracyInstruction = buildAccountingAccuracyRules_(data);
  const generalSubjectAccuracyInstruction = buildGeneralSubjectAccuracyRules_(data);

  const objectivesInstruction =
    data.objectiveMode === 'teacher'
      ? `
TEACHER-PROVIDED LEARNING OBJECTIVES

The teacher has supplied these objectives:

${data.teacherObjectives}

Use these objectives as the primary learning outcomes. Preserve their
intended meaning and address each objective in the content, activities,
examples and evaluation. Improve grammar only where necessary.

Do not replace these objectives with a different set. If any objective
appears unsuitable for the class, topic or duration, retain its meaning
and briefly flag the concern for the teacher to review.
`
      : `
AI-GENERATED LEARNING OBJECTIVES

Develop at least three specific, measurable and achievable objectives
appropriate to the class, subject, topic and duration.

Begin with:
"By the end of the lesson, students should be able to..."

Use observable verbs such as define, identify, explain, calculate,
compare, demonstrate or solve, as appropriate.
`;

  return `
You are an experienced Nigerian secondary-school teacher, curriculum
specialist and professional lesson-plan writer.

Prepare a complete, accurate, practical and classroom-ready lesson plan.

LESSON DETAILS
School: ${data.school}
Class: ${data.className}
Subject: ${data.subject}
Topic: ${data.topic}
Duration: ${data.duration}
Country: Nigeria
Selected teaching methods: ${data.selectedMethods.join(' and ')}

CURRICULUM AND CLASS LEVEL

${curriculumInstruction}

Use the expected learning level of the specified class. Do not claim
to have consulted a particular curriculum document or textbook unless
that is verified.

TEACHING METHODS

${data.selectedMethods.length > 0
  ? `The teacher selected the following teaching method(s):
${data.selectedMethods.map(function(method, index) {
  return (index + 1) + '. ' + method;
}).join('\n')}

Apply every selected method meaningfully. Explain what the teacher does,
what students do, and how each method supports the topic. If two methods
are selected, integrate them appropriately. Do not merely list them.`
  : `The teacher did not select a teaching method.

Recommend the most suitable teaching method or combination of methods
based on the subject, topic, class level, lesson duration and available
resources.

Explain why the recommended methods are suitable and demonstrate how
the teacher and students should use them during the lesson.`
}

LEARNING OBJECTIVES
${objectivesInstruction}

Align the content, activities, examples, summary and evaluation with
the selected learning objectives.

REQUIRED LESSON-PLAN STRUCTURE

1. LESSON INFORMATION
Include school, class, subject, topic, date as a blank field, duration
and teacher's name as a blank field.

2. PREVIOUS KNOWLEDGE
State what students should already know.

3. INSTRUCTIONAL OBJECTIVES
Present the objectives according to the selected objective mode.

4. INSTRUCTIONAL MATERIALS
List relevant teaching resources, including ICT resources where useful.

5. REFERENCE MATERIALS
Suggest relevant textbooks, curriculum documents or credible references.
Do not invent exact page numbers or claim unverified sources.

6. KEY WORDS AND CONCEPTS
Identify and explain important terms.

7. INTRODUCTION / SET INDUCTION
Capture interest and connect the topic to prior knowledge or everyday
experiences.

8. PRESENTATION / LESSON DEVELOPMENT
Divide the lesson into logical stages appropriate to the class and topic.
Use a Markdown table with EXACTLY these four columns:

| Lesson Stage / Time | Teacher Activities | Student Activities | Evaluation |

Use a separate row for EVERY timed stage, including introduction,
summary and evaluation/closure. Do not leave these stages outside the
table. Include stage time, teacher actions, student actions and suitable
checks for understanding. Explain the actual subject content thoroughly,
including worked examples, correct
calculations, demonstrations and answers where appropriate. For practical
subjects, include relevant safety measures.

TIME-ALLOCATION RULE (MANDATORY)
- Treat ${data.duration} as the TOTAL time available for the entire lesson.
- Include introduction/set induction, all teaching stages, summary,
  evaluation/closure and assignment instructions within that total.
- Show the time for every timed activity in the lesson-development table.
- The table MUST contain separate rows for the introduction/set induction,
  each teaching stage, summary, and evaluation/closure. If assignment
  instructions are timed, include them in the total and table as well.
- Do not list a timed stage in the time breakdown unless it also appears
  as a row in the lesson-development table.
- The table stage times and the written time-allocation breakdown must agree.
- Ensure the grand total equals the stated duration exactly.
- Do not add separate timed activities outside the total.
- Do not allocate the full duration to lesson development and then add
  introduction, summary or evaluation on top of it.
- State the arithmetic check, e.g. 3 + 7 + 12 + 10 + 5 + 3 = 40 minutes.
- If the duration is expressed in hours, convert it accurately to minutes.
- If the duration cannot be converted reliably, state the assumption.
ASSESSMENT FEASIBILITY AND LESSON CONSISTENCY RULES

- Ensure that the number and complexity of assessment questions are
  realistic for the time allocated.
- Do not allocate an unrealistically short period for students to
  complete several written questions.
- If five or more assessment questions are provided, allocate
  sufficient time or clearly identify which questions are oral,
  brief checks for understanding or follow-up assessment.
- Ensure that the evaluation activities in the lesson-development
  table agree with the formal EVALUATION section.
- Do not state that the teacher administers a particular number
  of questions or exercises and then provide a different number.
- Ensure that every activity described in the lesson-development
  table is consistent with the lesson summary and assignment.
- Avoid unnecessary repetition of identical questions across
  the lesson-development table, evaluation and assignment.
- Ensure that recommended teaching methods are consistent with
  the actual teacher and student activities.
- Where the lesson involves calculations, practical work or
  demonstrations, allow realistic time for students to participate
  and complete the required tasks.
- Do not sacrifice subject accuracy or meaningful student practice
  merely to fit too many activities into a short lesson.
- Do not automatically insist on five written assessment questions
  in every lesson. Select a realistic number and difficulty of
  assessment tasks based on the lesson duration and available time.

- Distinguish between oral questioning, quick formative checks
  and independent written assessment. Allocate realistic time
  for each.

- Ensure that students have enough time to demonstrate their
  understanding independently before the lesson ends.

- For mathematical concepts, ensure that definitions and
  explanations are accurate without introducing unnecessary
  complexity beyond the specified class level.  
MATHEMATICAL ACCURACY AND CLASSROOM FEASIBILITY RULES

Apply these rules to every lesson, especially Mathematics, Further
Mathematics, Financial Accounting, Economics, Physics, Chemistry
and other numerical subjects.

1. Verify every numerical example independently before including it.
   Recalculate all arithmetic and check that the final answer satisfies
   the original question or equations.

2. For simultaneous equations and other algebraic problems, substitute
   the proposed solution into every original equation to confirm that
   all equations are satisfied.

3. For word problems, check that the numerical values produce a
   meaningful and realistic scenario. Do not use examples that produce
   impossible, contradictory or unreasonable real-life results.

4. Check that all information supplied in a word problem is sufficient
   to determine the required answer. Do not introduce missing values
   or assumptions without clearly stating them.

5. For money-related examples, use realistic amounts and ensure that
   the resulting prices, costs, profits or balances make practical sense.

6. For measurement problems, verify the units, conversions and
   dimensions. Do not mix incompatible units without converting them.

7. For every worked example, show clear and logically ordered steps.
   Ensure that the final answer follows correctly from the working.

8. Ensure that guided-practice questions are appropriate for the class
   and that the teacher's expected answers or solutions are correct.

9. Do not introduce advanced concepts merely to make a lesson appear
   comprehensive. Stay within the specified class level and topic.

10. Check that the number of activities, examples and assessment tasks
    can realistically be completed within the stated lesson duration.

11. Do not allocate an unrealistically short period for several
    independent written questions. Distinguish between oral questions,
    quick formative checks and formal written assessment.

12. Ensure that the lesson-development table, formal evaluation and
    assignment are consistent. Do not claim that students completed
    questions or activities that were not actually provided.

13. If an example or question fails any accuracy or realism check,
    replace it with a correct example before presenting the lesson.

14. Never sacrifice mathematical correctness, subject accuracy or
    meaningful student participation merely to fill the lesson period.  
SUBJECT-MATTER ACCURACY RULES
${generalSubjectAccuracyInstruction}
${accountingAccuracyInstruction}
- Check every definition, formula, date, unit, example and worked solution.
- For numerical subjects, independently recompute every worked example,
  evaluation answer, assignment answer and objective-question answer.
- Show calculation steps and ensure the final answer follows from them.
- For accounting, distinguish assets, liabilities, capital, income,
  expenses and drawings correctly; do not confuse a Statement of Affairs
  with a fully verified Balance Sheet.
- Never describe single-entry bookkeeping as necessarily recording
  cash transactions only. Explain it as an incomplete system in which
  only one aspect of some transactions may be recorded.
- For multiple-choice questions, test all four options. Exactly one
  option must satisfy the question, and the stated answer must match it.
- Check that question numbering is continuous and that no requested
  question set is omitted or duplicated.

9. SUMMARY
Summarise the main concepts and skills taught.

10. EVALUATION
Provide at least five relevant assessment questions or tasks. Include
answers or expected responses where useful. These are separate from
any optional additional question sets.

11. ASSIGNMENT
Set a suitable follow-up task with clear instructions.

12. TEACHER'S REFLECTION
Provide blank prompts for objective achievement, student strengths,
difficulties, students needing support and improvements for next time.

${questionInstructions}

FINAL QUALITY-CONTROL CHECK — COMPLETE BEFORE RESPONDING
Silently audit the finished lesson plan and correct any errors you find:
1. Duration: add every timed activity, including introduction, lesson
   stages, evaluation, summary and closure. The total must equal the
   stated lesson duration exactly.
2. Objectives: each objective must be measurable, suitable for the class
   and addressed by teaching activities and evaluation.
3. Subject content: verify terminology, definitions, facts, examples,
   formulas, units and explanations.
4. Calculations: recompute every numerical answer independently. Check
   arithmetic, signs, units and the final result.
5. Objective questions: count them; verify each stem and all four options;
   ensure exactly one correct option; recalculate numerical questions;
   and ensure the answer key identifies that option.
6. Question sets: include every selected set, with exactly the requested
   number of questions. Do not include unselected sets. Use continuous
   section numbering without gaps.
7. Assignment: verify that its data are sufficient, instructions are
   clear and any supplied answer is correct.
8. Formatting: ensure tables are complete, headings are in order and no
   section, question, option or answer is cut off or repeated.
9. References: do not invent authors, titles, editions, URLs, page numbers
   or claims that a source was consulted. Mark suggested references as
   suggestions if they have not been verified.
10. Assessment feasibility: verify that the number and difficulty
    of evaluation questions are realistic for the allocated time.
    Check that the lesson-development table and formal evaluation
    agree on the activities and questions to be administered.

11. Internal consistency: check that the stated number of activities,
    questions, examples and exercises matches what is actually provided.
    Ensure teaching methods, objectives, lesson stages and assignment
    are consistent throughout the plan.
FINAL OUTPUT RULES — STRICTLY FOLLOW

- Output only the finished, classroom-ready lesson plan.
- Do not include internal analysis, private reasoning, planning notes,
  self-talk, draft content, alternative versions or process narration.
- Do not repeat or paraphrase the user's request.
- Do not describe what the user wants or explain how you prepared
  the lesson plan.
- Never include statements such as "The user wants...",
  "I need to follow...", "Let me plan this out...",
  "I will now prepare..." or similar commentary.
- Do not display calculations or deliberations made while checking
  the lesson plan. Include only the final verified answers and
  explanations relevant to the lesson.
- Begin immediately with the lesson-plan title or first required section.
- Follow the requested headings, structure and section order.
- Do not omit any required section or selected examination question set.
- End with the exact standalone marker:
  [[LESSON_PLAN_COMPLETE]]    
IMPORTANT REQUIREMENTS
- Make the lesson suitable for Nigerian students at the specified level.
- Explain the actual subject content, not just the teaching process.
- Align objectives, content, activities, summary and evaluation.
- Apply every selected teaching method meaningfully.
- Avoid vague statements and unnecessary repetition.
- Use clear headings, numbered sections, lists and readable formatting.
- Use Markdown headings, lists and tables where appropriate.
- Do not wrap the entire response in a code block.
- When the entire lesson plan and all selected question sets are complete
  and the quality-control checks have been performed, finish with this
  exact standalone marker: [[LESSON_PLAN_COMPLETE]].
- Do not write that marker until every required section and selected set
  has been completed and checked.
`;
}


/* =========================================================
   6A. SUBJECT-SPECIFIC ACCOUNTING RULES AND SAFETY CHECKS
   ========================================================= */

function buildAccountingAccuracyRules_(data) {
  const subject = String(data.subject || '').toLowerCase();
  const topic = String(data.topic || '').toLowerCase();
  if (subject.indexOf('account') === -1) return '';

  let rules = `ACCOUNTING-SPECIFIC ACCURACY REQUIREMENTS
- Use recognised accounting principles and terminology appropriate to the class.
- Never invent missing figures merely to make a Statement of Affairs balance.
- If information is insufficient to calculate profit or prepare a statement,
  explicitly identify the missing information and redesign the example with
  sufficient, internally consistent data.
- Reconcile every cash, bank, asset, liability and capital figure supplied.
- Distinguish a cash balance movement from accounting profit. A change in cash
  is not, by itself, profit or loss.
- Do not treat cash sales less cash purchases, adjusted only for changes in
  cash and drawings, as a generally valid profit formula. Other receipts,
  payments, credit transactions, expenses, capital introduced and asset
  movements may affect cash and profit differently.
- Where the conversion/capital-comparison method is taught, use:
  Profit = Closing Capital + Drawings - Additional Capital - Opening Capital.
  A negative result represents a loss.
- Calculate capital in a Statement of Affairs as total assets less total
  liabilities at the relevant date.
- State assumptions clearly. Do not silently assume that all unexplained
  assets are inventory or that liabilities are nil unless the question says so.
- For every numerical example and question, verify that the given data are
  sufficient, the statements reconcile and the answer follows from the data.
`;

  if (/single.?entry|incomplete record|statement of affairs/.test(topic)) {
    rules += `\nSPECIAL RULES FOR SINGLE ENTRY AND INCOMPLETE RECORDS
- Teach the Statement of Affairs and the conversion method as the principal
  capital-comparison approach for ascertaining profit or loss from incomplete
  records at this level.
- Prepare opening and closing Statements of Affairs from separately supplied
  asset and liability balances; derive capital as net assets.
- Include drawings and additional capital in the profit calculation.
- Do not introduce a so-called cash-flow method for calculating profit unless
  the question provides a complete, valid and explicitly defined method and
  all required information. Do not use the invalid shortcut based only on
  cash sales, cash purchases, opening cash, closing cash and drawings.
- Do not fabricate closing stock. Supply an inventory figure or enough valid
  information to calculate it. If no inventory data are supplied, do not
  present a completed Statement of Affairs that depends on an invented stock
  figure.
- Credit sales and credit purchases must not simply be ignored when the task
  is to determine total business profit. Provide the necessary debtor,
  creditor,
  returns, discounts, expenses and other relevant information, or limit the
  question explicitly to a clearly labelled partial cash analysis rather
  than calling the result total profit.
`;
  }
  return rules;
}

/**
 * Enforce the teacher's selected optional examination question sets.
 * This prevents an incomplete AI response from being returned as successful.
 * The check is intentionally structural; teachers must still verify content.
 */
function validateRequestedQuestionSets_(data, plan) {
  const selected = Array.isArray(data.questionTypes) ? data.questionTypes : [];
  if (!selected.length) return;

  const text = String(plan || '').replace(/\r\n?/g, '\n');
  const failures = [];
  const headingNames = ['THEORY QUESTIONS', 'SUBJECTIVE QUESTIONS', 'OBJECTIVE QUESTIONS'];

  function normalizeHeading_(line) {
    return String(line || '')
      .replace(/^\s*#{1,6}\s*/, '')
      .replace(/^\s*\d+\s*[.)-]\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .trim()
      .toUpperCase();
  }

  function extractSection_(name) {
    const lines = text.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      const heading = normalizeHeading_(lines[i]);
      if (heading.indexOf(name) === 0) {
        start = i + 1;
        break;
      }
    }
    if (start < 0) return '';

    const section = [];
    for (let i = start; i < lines.length; i++) {
      const heading = normalizeHeading_(lines[i]);
      if (headingNames.some(function(other) {
        return other !== name && heading.indexOf(other) === 0;
      })) break;
      if (/^(ANSWER KEY|TEACHER'?S REFLECTION|REFERENCES|END OF LESSON PLAN)\b/.test(heading)) break;
      section.push(lines[i]);
    }
    return section.join('\n').trim();
  }

  function questionNumbers_(section) {
    const found = [];
    const lines = String(section || '').split('\n');
    lines.forEach(function(line) {
      const value = line.trim();
      let match = value.match(/^(?:\*\*)?(?:QUESTION\s*)?(\d{1,2})(?:\*\*)?\s*[.)-]\s+/i);
      if (!match) match = value.match(/^(?:\*\*)?QUESTION\s+(\d{1,2})(?:\*\*)?\s*[:.)-]?\s+/i);
      if (match) found.push(Number(match[1]));
    });
    return found;
  }

  function checkSet_(key, heading, expected) {
    if (selected.indexOf(key) === -1) return;
    const section = extractSection_(heading);
    const numbers = questionNumbers_(section);
    const correctSequence = numbers.length === expected &&
      numbers.every(function(n, i) { return n === i + 1; });
    if (!section || !correctSequence) {
      failures.push(heading + ': expected exactly ' + expected +
        ' consecutively numbered questions; found ' + numbers.length + '.');
    }
    return section;
  }

  checkSet_('theory', 'THEORY QUESTIONS', 5);
  const subjective = checkSet_('subjective', 'SUBJECTIVE QUESTIONS', 10);
  if (subjective && selected.indexOf('subjective') !== -1) {
    const answerCount = (subjective.match(/\b(?:answer|expected response)\s*[:—-]/gi) || []).length;
    // Do not reject alternate valid layouts; the prompt requires an answer per question.
    if (answerCount > 0 && answerCount < 10) {
      failures.push('Subjective questions: some answers appear to be missing.');
    }
  }

  const objective = checkSet_('objective', 'OBJECTIVE QUESTIONS', 10);
  if (objective && selected.indexOf('objective') !== -1) {
    const optionLabels = objective.match(/^\s*(?:[-*]\s*)?(?:\*\*)?[A-D](?:\*\*)?[.)]\s+/gim) || [];
    if (optionLabels.length < 40) {
      failures.push('Objective questions: expected four labelled options (A–D) for each of 10 questions.');
    }
    if (!/\b(correct answer|answer key|answers)\b/i.test(objective)) {
      failures.push('Objective questions: no answer indication was found.');
    }
  }

  if (failures.length) {
    throw new Error(
      'The AI returned an incomplete or incorrectly structured question set. ' +
      failures.join(' ') + ' The incomplete result was not saved. Please generate again.'
    );
  }
}

/**
 * Deterministic guard against a known high-risk error in incomplete-records
 * lessons. This is deliberately a narrow safety check, not a claim that all
 * accounting content can be machine-verified.
 */
function validateGeneratedPlan_(data, plan) {
  const subject = String(data.subject || '').toLowerCase();
  const topic = String(data.topic || '').toLowerCase();
  if (subject.indexOf('account') === -1 ||
      !/single.?entry|incomplete record|statement of affairs/.test(topic)) {
    return;
  }

  const text = String(plan || '');
  const invalidCashProfitFormula =
    /profit\s*=\s*cash\s+sales\s*[-−]\s*cash\s+purchases/i.test(text) &&
    /closing\s+cash\s*[-−]\s*opening\s+cash/i.test(text);

  if (invalidCashProfitFormula) {
    throw new Error(
      'The generated accounting lesson contains a potentially invalid ' +
      'cash-based profit formula. The lesson was stopped rather than ' +
      'returned with an unreliable answer. Generate again, or remove ' +
      'the unsupported cash-flow calculation from the example.'
    );
  }
}
/**
 * Rejects obvious AI planning notes and self-correction comments.
 * This is a targeted quality check, not a complete assessment
 * of the factual accuracy of the generated lesson.
 */
function validateFinalOutput_(plan) {
  const text = String(plan || '');

  const unwantedPatterns = [
    /\bthe user wants\b/i,
    /\blet me plan this out\b/i,
    /\bi need to follow the detailed structure\b/i,
    /\bwait[,!—-]?\s+let me recalculate\b/i,
    /\blet me recalculate\b/i,
    /\bi need to recalculate\b/i,
    /\blet me think this through\b/i,
    /\bi will now prepare the lesson plan\b/i,
    /\bi will now generate the lesson plan\b/i,
    /\bfirst[, ]+i need to\b/i
  ];

  for (let i = 0; i < unwantedPatterns.length; i++) {
    if (unwantedPatterns[i].test(text)) {
      throw new Error(
        'The AI returned planning notes or self-correction ' +
        'instead of a clean final lesson plan. The result was ' +
        'not saved. Please click Generate AI Lesson Plan again. ' +
        'If the problem continues, try another AI provider.'
      );
    }
  }
}

/* =========================================================
   7. GENERATE WITH CONTROLLED CONTINUATION
   The first response is continued only when the provider indicates
   that it hit its output limit or omitted the completion marker.
   ========================================================= */


function generateWithContinuation_(provider, apiKey, prompt) {
  let result = provider === 'openrouter'
    ? callOpenRouterOnce_(apiKey, [
        { role: 'user', content: prompt }
      ])
    : callGeminiOnce_(apiKey, [
        { role: 'user', parts: [{ text: prompt }] }
      ]);

  let completeText = String(result.text || '').trim();
  let continuationCount = 0;

  if (!completeText) {
    throw new Error('The AI provider returned an empty lesson plan.');
  }

  while (
    !hasCompletionMarker_(completeText) &&
    isOutputLimitReached_(result.finishReason, provider) &&
    continuationCount < APP_CONFIG.MAX_CONTINUATION_CALLS
  ) {
    continuationCount++;

    const continuationPrompt =
      'Continue the lesson plan from the exact point where the previous ' +
      'response stopped. Do not repeat, summarise, restart or rewrite any ' +
      'earlier section. Do not reproduce the title, lesson information, ' +
      'objectives, references, introduction or any completed table rows. ' +
      'Continue only with the next unfinished content. Preserve all ' +
      'previous instructions, calculations, question numbering and ' +
      'remaining question counts. If the lesson plan is complete, finish ' +
      'with the exact standalone marker [[LESSON_PLAN_COMPLETE]].';

    if (provider === 'openrouter') {
      result = callOpenRouterOnce_(apiKey, [
        { role: 'user', content: prompt },
        { role: 'assistant', content: completeText },
        { role: 'user', content: continuationPrompt }
      ]);
    } else {
      result = callGeminiOnce_(apiKey, [
        { role: 'user', parts: [{ text: prompt }] },
        { role: 'model', parts: [{ text: completeText }] },
        { role: 'user', parts: [{ text: continuationPrompt }] }
      ]);
    }

    const nextText = String(result.text || '').trim();

    if (!nextText) {
      throw new Error(
        'The AI provider returned an empty continuation. Please try ' +
        'again or reduce the optional question sets.'
      );
    }

    completeText = appendContinuation_(completeText, nextText);

    if (completeText.length > APP_CONFIG.MAX_PLAN_LENGTH) {
      throw new Error(
        'The generated lesson plan exceeded the maximum allowed length. ' +
        'Reduce the optional question sets and try again.'
      );
    }
  }

  // Remove the completion marker when it exists.
  completeText = completeText
    .replace(/\s*\[\[LESSON_PLAN_COMPLETE\]\]\s*$/, '')
    .trim();

  // If the provider stopped normally, do not request another response
  // simply because it omitted the optional completion marker.
  if (!completeText) {
    throw new Error('The AI provider returned an empty lesson plan.');
  }

  // If the provider reached its output limit but continuation attempts
  // were exhausted, do not silently return an incomplete lesson plan.
  if (
    !hasCompletionMarker_(completeText) &&
    isOutputLimitReached_(result.finishReason, provider)
  ) {
    throw new Error(
      'The lesson plan exceeded the AI provider output limit and could ' +
      'not be completed. Try reducing the optional question sets.'
    );
  }

  return completeText;
}


/* =========================================================
   CHECK WHETHER THE AI PROVIDER REACHED ITS OUTPUT LIMIT
   ========================================================= */

function isOutputLimitReached_(finishReason, provider) {
  const reason = String(finishReason || '').toUpperCase();

  if (provider === 'openrouter') {
    return reason === 'LENGTH';
  }

  if (provider === 'gemini') {
    return reason === 'MAX_TOKENS';
  }

  return false;
}

function hasCompletionMarker_(text) {
  return /\[\[LESSON_PLAN_COMPLETE\]\]\s*$/.test(
    String(text || '').trim()
  );
}

function appendContinuation_(previous, next) {
  let left = String(previous || '').replace(/\s+$/, '');
  let right = String(next || '').replace(/^\s+/, '');

  // Some providers repeat a few trailing words from the previous turn.
  // Remove an exact overlap of up to 80 words to avoid duplicated text.
  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);
  const maxOverlap = Math.min(80, leftWords.length, rightWords.length);
  let overlap = 0;

  for (let n = maxOverlap; n >= 3; n--) {
    const a = leftWords.slice(-n).join(' ').toLowerCase();
    const b = rightWords.slice(0, n).join(' ').toLowerCase();
    if (a === b) {
      overlap = n;
      break;
    }
  }

  if (overlap) {
    right = rightWords.slice(overlap).join(' ');
  }

  return left + (right ? '\n\n' + right : '');
}


/* =========================================================
   8. GEMINI API CALL
   Returns text plus finish reason for continuation handling.
   ========================================================= */

function callGeminiOnce_(apiKey, contents) {
  const url = APP_CONFIG.GEMINI_API_BASE +
    encodeURIComponent(APP_CONFIG.GEMINI_MODEL) +
    ':generateContent';

  const payload = {
    contents: contents,
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: APP_CONFIG.MAX_OUTPUT_TOKENS
    }
  };

  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (error) {
    throw new Error(
      'Could not contact Gemini. Check your internet connection. ' +
      'No automatic retry was made.'
    );
  }

  const status = response.getResponseCode();
  const responseText = response.getContentText();
  if (status < 200 || status >= 300) {
    const apiMessage = getApiErrorMessage_(responseText);
    if (status === 429) {
      throw new Error(
        'Gemini quota or rate limit reached (HTTP 429). This is a ' +
        'provider limit, not a lesson-plan error. Wait until the quota ' +
        'resets or check your Gemini API billing and limits. Details: ' +
        apiMessage
      );
    }
    throw new Error(
      'Gemini lesson generation failed. HTTP ' + status + ': ' + apiMessage
    );
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch (error) {
    throw new Error('Gemini returned an unreadable response.');
  }

  const candidate = result.candidates && result.candidates.length
    ? result.candidates[0]
    : null;
  const parts = candidate && candidate.content && candidate.content.parts
    ? candidate.content.parts
    : [];
  const text = parts.map(function(part) {
    return part.text || '';
  }).join('\n').trim();

  if (!text) {
    const reason = candidate && candidate.finishReason
      ? candidate.finishReason
      : result.promptFeedback && result.promptFeedback.blockReason
        ? result.promptFeedback.blockReason
        : 'No text was returned.';
    throw new Error('Gemini did not return lesson-plan text. Reason: ' + reason);
  }

  return {
    text: text,
    finishReason: candidate ? candidate.finishReason || '' : ''
  };
}


/* =========================================================
   9. OPENROUTER API CALL
   Returns text plus finish reason for continuation handling.
   ========================================================= */

function callOpenRouterOnce_(apiKey, messages) {
  const payload = {
    model: APP_CONFIG.OPENROUTER_FREE_MODEL,
    messages: messages,
    temperature: 0.5,
    max_tokens: APP_CONFIG.MAX_OUTPUT_TOKENS
  };

  let response;
  try {
    response = UrlFetchApp.fetch(APP_CONFIG.OPENROUTER_API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'X-Title': APP_CONFIG.APP_TITLE
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    throw new Error(
      'The OpenRouter request could not be sent from Google Apps Script. ' +
      'This does not necessarily mean your internet connection is down. ' +
      'Check the endpoint, Apps Script permissions and Google service ' +
      'availability. Technical detail: ' + detail.substring(0, 700)
    );
  }

  const status = response.getResponseCode();
  const responseText = response.getContentText();
  if (status < 200 || status >= 300) {
    const apiMessage = getApiErrorMessage_(responseText);
    if (status === 429) {
      throw new Error(
        'OpenRouter rate limit or account quota reached (HTTP 429). ' +
        'Wait before trying again or check your OpenRouter account. ' +
        'Details: ' + apiMessage
      );
    }
    throw new Error(
      'OpenRouter lesson generation failed. HTTP ' + status + ': ' +
      apiMessage
    );
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch (error) {
    throw new Error('OpenRouter returned an unreadable response.');
  }

  const choices = result.choices || [];
  const choice = choices.length ? choices[0] : null;
  const content = choice && choice.message
    ? choice.message.content
    : '';
  const text = typeof content === 'string' ? content.trim() : '';

  if (!text) {
    throw new Error(
      'OpenRouter did not return lesson-plan text. The selected free ' +
      'model may be temporarily unavailable or out of quota.'
    );
  }

  return {
    text: text,
    finishReason: choice ? choice.finish_reason || '' : ''
  };
}


/* =========================================================
   10. BACKWARD-COMPATIBLE PROVIDER HELPERS
   Retained for the existing Gemini connection test.
   ========================================================= */

function callGeminiText_(apiKey, prompt) {
  return callGeminiOnce_(apiKey, [
    { role: 'user', parts: [{ text: prompt }] }
  ]).text;
}

function callOpenRouterFreeOnce_(apiKey, prompt) {
  return callOpenRouterOnce_(apiKey, [
    { role: 'user', content: prompt }
  ]).text;
}

/* =========================================================
   9. TEST THE GEMINI CONNECTION
   Run manually from the Apps Script editor when needed.
   This function makes one real Gemini API request.
   ========================================================= */

function testGeminiConnection() {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('GEMINI_API_KEY');

  if (!apiKey) {
    throw new Error(
      'Gemini API key not found. Add GEMINI_API_KEY under ' +
      'Project Settings > Script Properties.'
    );
  }

  const prompt =
    'Reply with exactly this text: Gemini connection successful.';

  const answer = callGeminiText_(apiKey, prompt);

  Logger.log(answer);
  return answer;
}


/* =========================================================
   9. EXPORT THE LESSON PLAN TO A FORMATTED WORD DOCUMENT
   ========================================================= */

function downloadLessonPlanDocx(lessonPlan, school, subject, topic) {
  if (!lessonPlan || !String(lessonPlan).trim()) {
    throw new Error('Please generate a lesson plan first.');
  }

  lessonPlan = String(lessonPlan);

  if (lessonPlan.length > APP_CONFIG.MAX_PLAN_LENGTH) {
    throw new Error(
      'The lesson plan is too long to export. Please shorten it.'
    );
  }

  school = cleanText_(
    school || 'Holy Child College, Ikoyi, Lagos'
  );

  subject = cleanText_(subject || 'Subject');
  topic = cleanText_(topic || 'Lesson Plan');

  let doc = null;

  try {
    doc = DocumentApp.create(
      'Temporary Lesson Plan - ' + subject
    );

    const body = doc.getBody();
    body.clear();

    body.setMarginTop(45);
    body.setMarginBottom(45);
    body.setMarginLeft(48);
    body.setMarginRight(48);

    lessonDocAddHeaderFooter_(doc, school);

    const schoolHeading = body.appendParagraph(school.toUpperCase());
    schoolHeading
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .setSpacingAfter(3);

    schoolHeading.editAsText().setAttributes(
      lessonDocAttributes_({
        FONT_FAMILY: APP_CONFIG.FONT,
        FONT_SIZE: 16,
        BOLD: true,
        FOREGROUND_COLOR: APP_CONFIG.WINE
      })
    );

    const slogan = body.appendParagraph(APP_CONFIG.SCHOOL_SLOGAN);
    slogan
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .setSpacingAfter(8);

    slogan.editAsText().setAttributes(
      lessonDocAttributes_({
        FONT_FAMILY: APP_CONFIG.FONT,
        FONT_SIZE: 9,
        ITALIC: true,
        FOREGROUND_COLOR: APP_CONFIG.MUTED_TEXT
      })
    );

    const title = body.appendParagraph('OFFICIAL LESSON NOTE');
    title
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .setSpacingAfter(5);

    title.editAsText().setAttributes(
      lessonDocAttributes_({
        FONT_FAMILY: APP_CONFIG.FONT,
        FONT_SIZE: 14,
        BOLD: true,
        FOREGROUND_COLOR: APP_CONFIG.DARK_WINE
      })
    );

    const subtitle = body.appendParagraph(subject + ' — ' + topic);
    subtitle
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .setSpacingAfter(12);

    subtitle.editAsText().setAttributes(
      lessonDocAttributes_({
        FONT_FAMILY: APP_CONFIG.FONT,
        FONT_SIZE: 10,
        ITALIC: true,
        FOREGROUND_COLOR: APP_CONFIG.MUTED_TEXT
      })
    );

    lessonDocAppendInfoTable_(
      body,
      school,
      subject,
      topic
    );

    body.appendParagraph('').setSpacingAfter(4);

    lessonDocAppendFormattedPlan_(body, lessonPlan);

    doc.saveAndClose();

    const exportUrl =
      'https://www.googleapis.com/drive/v3/files/' +
      encodeURIComponent(doc.getId()) +
      '/export?mimeType=' +
      encodeURIComponent(
        'application/vnd.openxmlformats-officedocument.' +
        'wordprocessingml.document'
      );

    const exportResponse = UrlFetchApp.fetch(exportUrl, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
      },
      muteHttpExceptions: true
    });

    const exportStatus = exportResponse.getResponseCode();

    if (exportStatus < 200 || exportStatus >= 300) {
      throw new Error(
        'Word export failed. HTTP ' + exportStatus + ': ' +
        getApiErrorMessage_(exportResponse.getContentText())
      );
    }

    const blob = exportResponse.getBlob().setContentType(
      'application/vnd.openxmlformats-officedocument.' +
      'wordprocessingml.document'
    );

    const filename =
      'Lesson_Plan_' + sanitizeFileName_(subject) + '_' +
      sanitizeFileName_(topic) + '.docx';

    return {
      filename: filename,
      base64: Utilities.base64Encode(blob.getBytes())
    };

  } finally {
    if (doc) {
      try {
        DriveApp.getFileById(doc.getId()).setTrashed(true);
      } catch (cleanupError) {
        console.warn(
          'Could not move the temporary document to Trash: ' +
          cleanupError.message
        );
      }
    }
  }
}


/* =========================================================
   10. WORD DOCUMENT HEADER AND FOOTER
   ========================================================= */

function lessonDocAddHeaderFooter_(doc, school) {
  const header = doc.addHeader();
  const headerParagraph = header.appendParagraph(school);
  headerParagraph
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  headerParagraph.editAsText().setAttributes(
    lessonDocAttributes_({
      FONT_FAMILY: APP_CONFIG.FONT,
      FONT_SIZE: 8,
      BOLD: true,
      FOREGROUND_COLOR: APP_CONFIG.WINE
    })
  );

  const footer = doc.addFooter();
  const footerParagraph = footer.appendParagraph(
    APP_CONFIG.SCHOOL_SLOGAN + '  |  ' +
    'Prepared with ' + APP_CONFIG.APP_TITLE
  );

  footerParagraph
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  footerParagraph.editAsText().setAttributes(
    lessonDocAttributes_({
      FONT_FAMILY: APP_CONFIG.FONT,
      FONT_SIZE: 8,
      FOREGROUND_COLOR: APP_CONFIG.MUTED_TEXT
    })
  );
}


/* =========================================================
   11. WORD DOCUMENT LESSON INFORMATION TABLE
   ========================================================= */

function lessonDocAppendInfoTable_(body, school, subject, topic) {
  const rows = [
    ['SCHOOL', school],
    ['SUBJECT', subject],
    ['TOPIC', topic],
    ['CLASS', '________________________________'],
    ['DATE', '________________________________'],
    ['DURATION', '________________________________'],
    ['TEACHER', '________________________________']
  ];

  const table = body.appendTable(rows);

  table.setBorderColor(APP_CONFIG.TABLE_BORDER);
  table.setBorderWidth(0.75);

  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    const labelCell = row.getCell(0);
    const valueCell = row.getCell(1);

    labelCell.setBackgroundColor(APP_CONFIG.CREAM);

    [labelCell, valueCell].forEach(function(cell) {
      cell.setPaddingTop(5);
      cell.setPaddingBottom(5);
      cell.setPaddingLeft(7);
      cell.setPaddingRight(7);

      cell.editAsText().setAttributes(
        lessonDocAttributes_({
          FONT_FAMILY: APP_CONFIG.FONT,
          FONT_SIZE: 9,
          FOREGROUND_COLOR: APP_CONFIG.DARK_TEXT
        })
      );
    });

    labelCell.editAsText().setAttributes(
      lessonDocAttributes_({
        FONT_FAMILY: APP_CONFIG.FONT,
        FONT_SIZE: 8,
        BOLD: true,
        FOREGROUND_COLOR: APP_CONFIG.DARK_WINE
      })
    );
  }

  try {
    table.setColumnWidth(0, 105);
    table.setColumnWidth(1, 380);
  } catch (ignored) {
    // Google Docs may adjust widths automatically.
  }

  return table;
}


/* =========================================================
   12. PARSE AND FORMAT LESSON-PLAN MARKDOWN
   Supports headings, paragraphs, lists and editable tables.
   ========================================================= */

function lessonDocAppendFormattedPlan_(body, lessonPlan) {
  const lines = String(lessonPlan)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      index++;
      continue;
    }

    // Markdown table: collect consecutive table rows.
    if (lessonDocIsPipeRow_(trimmed)) {
      const tableLines = [];
      while (index < lines.length && lessonDocIsPipeRow_(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index++;
      }
      lessonDocAppendMarkdownTable_(body, tableLines);
      continue;
    }

    const markdownHeading = /^#{1,6}\s+/.test(trimmed);
    const cleanHeading = trimmed
      .replace(/^#{1,6}\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .trim();

    if (markdownHeading || lessonDocLooksLikeHeading_(cleanHeading)) {
      lessonDocAppendHeading_(body, cleanHeading);
      index++;
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[-*+]\s+/, '');
      const listItem = body.appendListItem(lessonDocCleanInline_(itemText));
      listItem.setGlyphType(DocumentApp.GlyphType.BULLET);
      lessonDocStyleListItem_(listItem);
      index++;
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^\d+[.)]\s+/, '');
      const listItem = body.appendListItem(lessonDocCleanInline_(itemText));
      listItem.setGlyphType(DocumentApp.GlyphType.NUMBER);
      lessonDocStyleListItem_(listItem);
      index++;
      continue;
    }

    const paragraph = body.appendParagraph(lessonDocCleanInline_(trimmed));
    paragraph.setSpacingAfter(4).setLineSpacing(1.15);
    paragraph.editAsText().setAttributes(lessonDocAttributes_({
      FONT_FAMILY: APP_CONFIG.FONT,
      FONT_SIZE: 10,
      FOREGROUND_COLOR: APP_CONFIG.DARK_TEXT
    }));
    index++;
  }
}

/* =========================================================
   13. FORMAT A SECTION HEADING
   ========================================================= */

function lessonDocAppendHeading_(body, text) {
  const heading = body.appendParagraph(
    lessonDocCleanInline_(text)
  );

  heading
    .setHeading(DocumentApp.ParagraphHeading.HEADING2)
    .setSpacingBefore(10)
    .setSpacingAfter(4);

  heading.editAsText().setAttributes(
    lessonDocAttributes_({
      FONT_FAMILY: APP_CONFIG.FONT,
      FONT_SIZE: 11,
      BOLD: true,
      FOREGROUND_COLOR: APP_CONFIG.WINE
    })
  );

  return heading;
}


/* =========================================================
   14. FORMAT A LIST ITEM
   ========================================================= */

function lessonDocStyleListItem_(listItem) {
  listItem
    .setSpacingAfter(3)
    .setLineSpacing(1.1);

  listItem.editAsText().setAttributes(
    lessonDocAttributes_({
      FONT_FAMILY: APP_CONFIG.FONT,
      FONT_SIZE: 10,
      FOREGROUND_COLOR: APP_CONFIG.DARK_TEXT
    })
  );
}


/* =========================================================
   15. MARKDOWN TABLE HELPERS
   ========================================================= */

function lessonDocIsPipeRow_(line) {
  const text = String(line || '').trim();

  return text.indexOf('|') !== -1 &&
    text.length > 1;
}


function lessonDocIsMarkdownSeparator_(line) {
  const cells = lessonDocParsePipeRow_(line);

  return cells.length > 0 && cells.every(function(cell) {
    return /^:?-{3,}:?$/.test(
      String(cell).replace(/\s/g, '')
    );
  });
}


function lessonDocParsePipeRow_(line) {
  let text = String(line || '').trim();

  if (text.charAt(0) === '|') {
    text = text.substring(1);
  }

  if (text.charAt(text.length - 1) === '|') {
    text = text.substring(0, text.length - 1);
  }

  return text.split('|').map(function(cell) {
    return lessonDocCleanInline_(cell.trim());
  });
}


function lessonDocAppendMarkdownTable_(body, tableLines) {
  const usableLines = tableLines.filter(function(line) {
    return !lessonDocIsMarkdownSeparator_(line);
  });

  if (usableLines.length === 0) {
    return;
  }

  const parsedRows = usableLines.map(function(line) {
    return lessonDocParsePipeRow_(line);
  });

  let columnCount = 0;

  parsedRows.forEach(function(row) {
    columnCount = Math.max(columnCount, row.length);
  });

  if (columnCount === 0) {
    return;
  }

  const tableData = parsedRows.map(function(row) {
    const fixedRow = row.slice();

    while (fixedRow.length < columnCount) {
      fixedRow.push('');
    }

    return fixedRow;
  });

  const table = body.appendTable(tableData);

  table.setBorderColor(APP_CONFIG.TABLE_BORDER);
  table.setBorderWidth(0.5);

  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);

    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);

      cell.setPaddingTop(5);
      cell.setPaddingBottom(5);
      cell.setPaddingLeft(5);
      cell.setPaddingRight(5);

      if (r === 0) {
        cell.setBackgroundColor(APP_CONFIG.WINE);

        cell.editAsText().setAttributes(
          lessonDocAttributes_({
            FONT_FAMILY: APP_CONFIG.FONT,
            FONT_SIZE: 8,
            BOLD: true,
            FOREGROUND_COLOR: APP_CONFIG.WHITE
          })
        );
      } else {
        if (r % 2 === 0) {
          cell.setBackgroundColor(APP_CONFIG.LIGHT_CREAM);
        } else {
          cell.setBackgroundColor(APP_CONFIG.WHITE);
        }

        cell.editAsText().setAttributes(
          lessonDocAttributes_({
            FONT_FAMILY: APP_CONFIG.FONT,
            FONT_SIZE: 8,
            FOREGROUND_COLOR: APP_CONFIG.DARK_TEXT
          })
        );
      }
    }
  }

  body.appendParagraph('').setSpacingAfter(3);
}


/* =========================================================
   16. DETECT STANDALONE SECTION HEADINGS
   Avoid treating numbered questions as headings.
   ========================================================= */

function lessonDocLooksLikeHeading_(line) {
  const text = String(line || '').trim();

  if (!text || text.length > 100) {
    return false;
  }

  const knownHeadings =
    /^(LESSON PLAN|LESSON INFORMATION|LESSON DETAILS|PREVIOUS KNOWLEDGE|INSTRUCTIONAL OBJECTIVES|LEARNING OBJECTIVES|OBJECTIVES|INSTRUCTIONAL MATERIALS|TEACHING MATERIALS|TEACHING RESOURCES|REFERENCE MATERIALS|REFERENCES|KEY WORDS AND CONCEPTS|KEY WORDS|INTRODUCTION|INTRODUCTION \/ SET INDUCTION|SET INDUCTION|PRESENTATION|PRESENTATION \/ LESSON DEVELOPMENT|LESSON PRESENTATION|LESSON DEVELOPMENT|ASSESSMENT|EVALUATION|SUMMARY|CONCLUSION|ASSIGNMENT|TEACHER'S REFLECTION|TEACHER REFLECTION|FOLLOW-UP ACTIVITY|DIFFERENTIATION|ADDITIONAL EXAMINATION PRACTICE QUESTIONS|EXAMINATION \/ PRACTICE QUESTIONS|OBJECTIVE QUESTIONS|THEORY QUESTIONS|SUBJECTIVE QUESTIONS|ANSWER KEY|MARKING GUIDE)$/i;

  if (knownHeadings.test(text.replace(/:$/, ''))) {
    return true;
  }

  // Numbered section headings only when the remainder is a short,
  // heading-like phrase, not a question or a complete instruction.
  const numberedHeading =
    text.match(/^(\d{1,2})[.)]\s+(.+)$/);

  if (numberedHeading) {
    const remainder = numberedHeading[2].trim();

    if (
      remainder.length <= 65 &&
      !/[?]$/.test(remainder) &&
      !/^(define|explain|state|list|calculate|what|why|how|give|name|describe)\b/i
        .test(remainder)
    ) {
      return true;
    }
  }

  return /^[A-Z][A-Z0-9\s/&(),:'’\-–]{2,75}$/.test(text) &&
    /[A-Z]/.test(text);
}


/* =========================================================
   17. CLEAN MARKDOWN INLINE FORMATTING
   ========================================================= */

function lessonDocCleanInline_(value) {
  let text = String(value == null ? '' : value);
  text = text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\\?\s*<br\s*\/?\s*>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

  text = text.replace(/&#(\d+);/g, function(match, number) {
    const code = Number(number);
    return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : match;
  });
  text = text.replace(/&#x([0-9a-f]+);/gi, function(match, hex) {
    const code = parseInt(hex, 16);
    return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : match;
  });

  return text
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/__(.*?)__/gs, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/~~(.*?)~~/gs, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

/* =========================================================
   18. DOCUMENT TEXT ATTRIBUTES
   ========================================================= */

function lessonDocAttributes_(attributes) {
  return attributes;
}


/* =========================================================
   19. GENERAL HELPER FUNCTIONS
   ========================================================= */

function getFormValue_(formData, possibleNames) {
  for (let i = 0; i < possibleNames.length; i++) {
    const name = possibleNames[i];

    if (
      formData[name] !== undefined &&
      formData[name] !== null &&
      String(formData[name]).trim() !== ''
    ) {
      return String(formData[name]).trim();
    }
  }

  return '';
}


function cleanText_(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\u0000/g, '')
    // Convert common HTML line-breaks into real line breaks before export.
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    // Remove accidental escaping of ordinary Markdown markers.
    // LaTeX commands and other meaningful backslashes are preserved.
    .replace(/\\([#*_])/g, '$1')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


/**
 * Subject-aware guidance for commonly taught Nigerian secondary subjects.
 * These are guardrails for generation, not a substitute for teacher review.
 */
function buildGeneralSubjectAccuracyRules_(data) {
  const subject = String(data.subject || '').toLowerCase();
  const topic = String(data.topic || '').toLowerCase();
  let rules = `GENERAL SUBJECT QUALITY REQUIREMENTS
- Use the correct terminology, conventions, units and level of detail for
  the named subject and class.
- Do not fabricate curriculum references, textbook editions, page numbers,
  examination years, statistics, quotations or source attributions.
- Distinguish established facts from assumptions and illustrative examples.
- Where a topic has competing conventions, state the convention being used.
- Do not create numerical data that contradicts other data in the same task.
- For every calculation, show enough working for a teacher to verify it.
- Do not claim a student has mastered an objective merely because it was
  mentioned; include an observable check or assessment task.
`;

  if (/mathematics|further mathematics/.test(subject)) {
    rules += `MATHEMATICS-SPECIFIC CHECKS
- Recalculate every answer independently and check signs, brackets,
  substitutions, units, rounding and equivalent forms.
- Verify solutions by substituting them into the original equation or
  checking the original conditions.
- Do not present an approximation as an exact answer.
- Ensure diagrams, tables and stated dimensions agree with the question.
`;
  } else if (/economics/.test(subject)) {
    rules += `ECONOMICS-SPECIFIC CHECKS
- Distinguish demand from quantity demanded and supply from quantity supplied.
- State ceteris paribus assumptions where relevant.
- Distinguish movements along a curve from shifts of the curve.
- Define economic terms precisely and ensure examples match the concept.
- Check all numerical tables, percentages, averages and graph labels.
`;
  } else if (/commerce/.test(subject)) {
    rules += `COMMERCE-SPECIFIC CHECKS
- Distinguish related commercial terms, institutions, documents and processes.
- Use current, context-appropriate Nigerian examples without inventing
  statutory requirements, fees or institutional policies.
- Ensure examples illustrate the exact commercial concept being taught.
`;
  } else if (/biology|agricultural science/.test(subject)) {
    rules += `BIOLOGY / AGRICULTURAL SCIENCE CHECKS
- Use accepted biological and agricultural terminology.
- Distinguish observation, hypothesis, theory and conclusion correctly.
- Check classification, functions, processes and cause-effect explanations.
- Include practical safety and humane handling measures where relevant.
- Do not invent experimental results; label hypothetical data clearly.
`;
  } else if (/chemistry/.test(subject)) {
    rules += `CHEMISTRY-SPECIFIC CHECKS
- Balance chemical equations and verify formulae, charges and state symbols.
- Check mole calculations, units, significant figures and stoichiometric ratios.
- Distinguish atoms, molecules, ions, elements and compounds accurately.
- Include appropriate laboratory safety precautions.
`;
  } else if (/physics/.test(subject)) {
    rules += `PHYSICS-SPECIFIC CHECKS
- State symbols, SI units and assumptions for each formula.
- Check dimensional consistency and independently recompute all numerical work.
- Distinguish scalar and vector quantities where relevant.
- Ensure practical procedures include appropriate safety precautions.
`;
  } else if (/english|literature/.test(subject)) {
    rules += `ENGLISH / LITERATURE CHECKS
- Use standard grammar, spelling, punctuation and terminology.
- Ensure examples actually demonstrate the stated grammatical or literary
  feature. Distinguish a writer's technique from its effect on the reader.
- Do not invent quotations or attribute lines to a literary text without
  reliable source evidence. If a text is not supplied, use original examples.
`;
  } else if (/government|civic education|history/.test(subject)) {
    rules += `HUMANITIES / CIVIC CHECKS
- Check dates, constitutional terms, institutions, historical sequence and
  distinctions between facts and interpretations.
- Avoid presenting disputed interpretations as uncontested facts.
- Do not invent legal provisions, constitutional sections or historical
  quotations. Identify the relevant country and period where needed.
`;
  }

  if (/single.?entry|incomplete record|statement of affairs/.test(topic) &&
      /account/.test(subject)) {
    rules += `TOPIC-SPECIFIC ACCOUNTING REMINDER
- Include the effect of drawings in cash and goods where relevant.
- Treat a bank overdraft as a liability, not a positive bank asset.
- Treat personal assets introduced into the business as additional capital
  only when the question states that they were introduced.
`;
  }
  return rules;
}



function sanitizeFileName_(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w\-]/g, '')
    .substring(0, 80) || 'Lesson_Plan';
}


function buildRequestCacheKey_(requestId) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(requestId),
    Utilities.Charset.UTF_8
  );

  return 'lesson_' + Utilities.base64EncodeWebSafe(bytes)
    .replace(/=+$/g, '')
    .substring(0, 80);
}


function getApiErrorMessage_(responseText) {
  try {
    const parsed = JSON.parse(responseText);

    if (parsed.error && parsed.error.message) {
      return String(parsed.error.message).substring(0, 1000);
    }
  } catch (error) {
    // Use a shortened original response if it is not JSON.
  }

  return String(responseText || 'Unknown API error.')
    .substring(0, 1000);
}


/* =========================================================
   20. AUTHORISE DRIVE ACCESS
   Run manually from the Apps Script editor when needed.
   ========================================================= */

function authorizeDriveAccess() {
  const file = DocumentApp.create(
    'Temporary Drive Authorization Test'
  );

  const fileId = file.getId();
  file.saveAndClose();

  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (error) {
    console.warn(
      'The temporary authorization document could not be trashed.'
    );
  }

  return 'Drive and Google Docs access has been authorized.';
}
