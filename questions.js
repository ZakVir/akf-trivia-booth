/* PLACEHOLDER QUESTIONS built only from the facts in the booth plan.
   Replace with the real 30 once they arrive. Fields:
   q, choices (4), answer (index 0-3), fact (host says it), kidFact (simple wording),
   emoji, level: 'kids' | 'everyone' | 'hard'. Fact-check before the event. */
window.QUESTIONS = [
  { level: 'kids', emoji: '🤝',
    q: 'AKF helps families get better schools, food and health. What kind of group is it?',
    choices: ['A toy company', 'A non-profit that helps people', 'An ice cream shop', 'An airline'], answer: 1,
    fact: 'The Aga Khan Foundation is a private, non-profit international development agency.',
    kidFact: 'AKF is a non-profit. That means it works to help people, not to make money!' },

  { level: 'kids', emoji: '🔤',
    q: 'What do the letters AKF stand for?',
    choices: ['Aga Khan Foundation', 'Always Kind Friends', 'All Kids Fly', 'Apple Kite Factory'], answer: 0,
    fact: 'AKF stands for the Aga Khan Foundation, part of the Aga Khan Development Network (AKDN).',
    kidFact: 'AKF is the Aga Khan Foundation. It is part of a big family of helpers called AKDN.' },

  { level: 'kids', emoji: '🚫',
    q: 'Which one is NOT something AKF works on?',
    choices: ['Schools and learning', 'Health and food', 'Building video games', 'Climate and farming'], answer: 2,
    fact: 'AKF focuses on agriculture and food security, civil society, climate resilience, early childhood development, education, and health and nutrition.',
    kidFact: 'AKF helps with learning, food, health and the climate. Not video games (sorry!).' },

  { level: 'everyone', emoji: '📅',
    q: 'In what year was the Aga Khan Foundation founded?',
    choices: ['1947', '1967', '1987', '2007'], answer: 1,
    fact: 'Aga Khan IV founded AKF in 1967.',
    kidFact: 'AKF started in 1967. That is a long time of helping people!' },

  { level: 'everyone', emoji: '🌍',
    q: 'Where is the Aga Khan Foundation based?',
    choices: ['Paris', 'New York', 'Geneva', 'Cairo'], answer: 2,
    fact: 'AKF is based in Geneva, and AKF USA raises money and builds partnerships in the US.',
    kidFact: 'AKF is based in Geneva, a city in Switzerland.' },

  { level: 'everyone', emoji: '🗺️',
    q: 'About how many countries does AKF work in?',
    choices: ['7', '17', '70', '170'], answer: 1,
    fact: 'AKF works in 17 countries across Africa, Asia, Europe, the Middle East and North America.',
    kidFact: 'AKF helps people in 17 countries on lots of continents!' },

  { level: 'everyone', emoji: '👧',
    q: 'AKF puts a special focus on which group of people?',
    choices: ['Women and girls', 'Pilots', 'Chefs', 'Skateboarders'], answer: 0,
    fact: 'AKF focuses on the root causes of poverty, with an emphasis on women and girls.',
    kidFact: 'AKF works extra hard to help women and girls.' },

  { level: 'everyone', emoji: '🌐',
    q: 'AKF is part of which network?',
    choices: ['Aga Khan Development Network', 'World Soccer League', 'Global Pizza Club', 'Ski Patrol Alliance'], answer: 0,
    fact: 'AKF is part of the Aga Khan Development Network, AKDN.',
    kidFact: 'AKF is part of AKDN, a big team of organizations that help people.' },

  { level: 'hard', emoji: '🧒',
    q: 'About how many children did AKF early childhood programs reach in 2025?',
    choices: ['23,000', '230,000', '2.3 million', '23 million'], answer: 2,
    fact: 'AKF early childhood programs reached 2.3 million children in 2025.',
    kidFact: 'Millions of little kids, 2.3 million, got a better start in 2025.' },

  { level: 'hard', emoji: '📚',
    q: 'About how many learners did AKF education programs reach in 2025?',
    choices: ['73,000', '730,000', '7.3 million', '73 million'], answer: 1,
    fact: 'AKF education programs reached 730,000 learners in 2025.',
    kidFact: '730,000 students got help to learn in 2025!' },

  { level: 'hard', emoji: '🇺🇸',
    q: 'What does AKF USA do?',
    choices: ['Runs airlines', 'Raises money and builds partnerships in the US', 'Makes snacks', 'Sells tickets'], answer: 1,
    fact: 'AKF USA raises money and builds partnerships in the United States to support AKF programs.',
    kidFact: 'AKF USA finds friends and funds in America to help AKF work around the world.' }
];
