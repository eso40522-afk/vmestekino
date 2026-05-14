// Библиотека фильмов для ВместеКино
// Используются бесплатные видео с открытых источников

export interface Movie {
  id: string
  title: string
  year: number
  genre: string[]
  duration: string
  rating: number
  description: string
  poster: string
  videoUrl: string
}

export const movies: Movie[] = [
  // ===== BLENDER FOUNDATION (Open Source Movies) =====
  {
    id: '1',
    title: 'Большой кролик Бак',
    year: 2008,
    genre: ['Анимация', 'Комедия', 'Семейный'],
    duration: '10 мин',
    rating: 8.2,
    description: 'Короткометражный анимационный фильм о гигантском кролике Баке, который мирно живёт на лугу. Три грызуна решают подшутить над ним, но Бак не собирается мириться с этим и готовит им сюрприз.',
    poster: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/220px-Big_buck_bunny_poster_big.jpg',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  },
  {
    id: '2',
    title: 'Мечты слона',
    year: 2006,
    genre: ['Анимация', 'Фантастика', 'Драма'],
    duration: '11 мин',
    rating: 7.5,
    description: 'Первый фильм, созданный с помощью Blender. История о двух персонажах — Эмо и Праг — которые исследуют странный механический мир. Фильм исследует темы творчества и восприятия реальности.',
    poster: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Elephants_Dream_s5_both.jpg/220px-Elephants_Dream_s5_both.jpg',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4'
  },
  {
    id: '3',
    title: 'Синтел',
    year: 2010,
    genre: ['Анимация', 'Фэнтези', 'Драма'],
    duration: '15 мин',
    rating: 8.0,
    description: 'Молодая девушка Синтел находит раненого детёныша дракона и выхаживает его. Когда взрослый дракон похищает её друга, она отправляется в эпическое путешествие через горы и пустыни, чтобы спасти его.',
    poster: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Sintel_poster.jpg/220px-Sintel_poster.jpg',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4'
  },
  {
    id: '4',
    title: 'Слёзы стали',
    year: 2012,
    genre: ['Анимация', 'Sci-Fi', 'Экшн'],
    duration: '12 мин',
    rating: 7.8,
    description: 'Научно-фантастический боевик о группе воинов, сражающихся с армией роботов в постапокалиптическом мире. Главный герой сталкивается с тяжёлым выбором, когда узнаёт правду о своём враге.',
    poster: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Tears_of_Steel_Poster.jpg/220px-Tears_of_Steel_Poster.jpg',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4'
  },

  // ===== КОРОТКОМЕТРАЖКИ =====
  {
    id: '5',
    title: 'For Bigger Blazes',
    year: 2015,
    genre: ['Комедия', 'Короткометражка'],
    duration: '15 сек',
    rating: 7.0,
    description: 'Динамичный короткий ролик, демонстрирующий захватывающие моменты и яркие спецэффекты.',
    poster: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
  },
  {
    id: '6',
    title: 'For Bigger Escapes',
    year: 2015,
    genre: ['Приключения', 'Короткометражка'],
    duration: '15 сек',
    rating: 7.2,
    description: 'Захватывающий мини-фильм о побеге и приключениях. Идеально для любителей экшна.',
    poster: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4'
  },
  {
    id: '7',
    title: 'For Bigger Fun',
    year: 2015,
    genre: ['Комедия', 'Короткометражка'],
    duration: '1 мин',
    rating: 6.8,
    description: 'Весёлый и динамичный клип для хорошего настроения.',
    poster: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4'
  },
  {
    id: '8',
    title: 'For Bigger Joyrides',
    year: 2015,
    genre: ['Приключения', 'Короткометражка'],
    duration: '15 сек',
    rating: 7.1,
    description: 'Адреналиновая поездка для любителей скорости и острых ощущений.',
    poster: 'https://images.unsplash.com/photo-1594909122845-11baa439b7bf?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4'
  },
  {
    id: '9',
    title: 'For Bigger Meltdowns',
    year: 2015,
    genre: ['Драма', 'Короткометражка'],
    duration: '15 сек',
    rating: 6.9,
    description: 'Эмоциональный и напряжённый мини-фильм о критических моментах.',
    poster: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4'
  },

  // ===== АВТОМОБИЛЬНЫЕ ОБЗОРЫ =====
  {
    id: '10',
    title: 'Subaru Outback',
    year: 2020,
    genre: ['Авто', 'Обзор'],
    duration: '1 мин',
    rating: 7.5,
    description: 'Обзор Subaru Outback на бездорожье и асфальте. Узнайте о возможностях этого универсального автомобиля.',
    poster: 'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4'
  },
  {
    id: '11',
    title: 'Volkswagen GTI Review',
    year: 2020,
    genre: ['Авто', 'Обзор'],
    duration: '1 мин',
    rating: 7.8,
    description: 'Детальный обзор культового хэтчбека Volkswagen GTI. Спортивный характер в практичном кузове.',
    poster: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/VolkswagenGTIReview.mp4'
  },
  {
    id: '12',
    title: 'What care can you get?',
    year: 2020,
    genre: ['Авто', 'Обзор'],
    duration: '2 мин',
    rating: 7.0,
    description: 'Сравнительный обзор различных автомобилей. Какую машину выбрать под ваш бюджет?',
    poster: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4'
  },

  // ===== ПРИРОДА И ДОКУМЕНТАЛЬНЫЕ =====
  {
    id: '13',
    title: 'Красоты природы',
    year: 2021,
    genre: ['Документальный', 'Природа'],
    duration: '3 мин',
    rating: 8.5,
    description: 'Потрясающие пейзажи нашей планеты. От горных вершин до глубин океана — красота природы во всём её великолепии.',
    poster: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=300&h=450&fit=crop',
    videoUrl: 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4'
  },

  // ===== МУЗЫКАЛЬНЫЕ =====
  {
    id: '14',
    title: 'Caminandes: Llama Drama',
    year: 2013,
    genre: ['Анимация', 'Комедия'],
    duration: '2 мин',
    rating: 7.9,
    description: 'Забавная история о ламе Коро, которая пытается пересечь дорогу в Патагонии. Но ограждение и проезжающие машины постоянно мешают ей.',
    poster: 'https://images.unsplash.com/photo-1517423440428-a5a00ad493e8?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
  },
  {
    id: '15',
    title: 'Cosmos Laundromat',
    year: 2015,
    genre: ['Анимация', 'Фэнтези', 'Комедия'],
    duration: '12 мин',
    rating: 8.1,
    description: 'Овца по имени Франк устала от жизни и решает покончить с собой. Но странный пришелец Виктор предлагает ему увидеть параллельные вселенные.',
    poster: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4'
  },

  // ===== ЭКШН И ТРИЛЛЕРЫ =====
  {
    id: '16',
    title: 'Agent 327: Operation Barbershop',
    year: 2017,
    genre: ['Анимация', 'Экшн', 'Комедия'],
    duration: '4 мин',
    rating: 8.3,
    description: 'Секретный агент 327 расследует подозрительную парикмахерскую в Амстердаме. Его ждут неожиданные противники и взрывные сюрпризы.',
    poster: 'https://images.unsplash.com/photo-1509347528160-9a9e33742cdb?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4'
  },
  {
    id: '17',
    title: 'Spring',
    year: 2019,
    genre: ['Анимация', 'Фэнтези', 'Драма'],
    duration: '8 мин',
    rating: 8.4,
    description: 'Поэтичная история о духе весны — молодой девушке, которая путешествует по замёрзшему лесу, пробуждая природу от зимнего сна.',
    poster: 'https://images.unsplash.com/photo-1462275646964-a0e3571f4f1c?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  },
  {
    id: '18',
    title: 'Coffee Run',
    year: 2020,
    genre: ['Анимация', 'Комедия'],
    duration: '3 мин',
    rating: 7.6,
    description: 'Простая поездка за кофе превращается в безумное приключение. Стильный анимационный фильм от Blender Studio.',
    poster: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4'
  },

  // ===== ДЕТСКИЕ =====
  {
    id: '19',
    title: 'Пиксиарная сказка',
    year: 2019,
    genre: ['Анимация', 'Семейный', 'Сказка'],
    duration: '5 мин',
    rating: 8.0,
    description: 'Волшебная сказка для всей семьи о дружбе и приключениях маленьких существ в большом мире.',
    poster: 'https://images.unsplash.com/photo-1560169897-fc0cdbdfa4d5?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4'
  },
  {
    id: '20',
    title: 'Charge',
    year: 2022,
    genre: ['Анимация', 'Экшн', 'Комедия'],
    duration: '4 мин',
    rating: 7.7,
    description: 'Динамичный мультфильм о группе героев, спешащих на помощь. Яркие краски и энергичный сюжет.',
    poster: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=300&h=450&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4'
  }
]

export const genres = [
  'Все',
  'Анимация',
  'Комедия',
  'Драма',
  'Фэнтези',
  'Sci-Fi',
  'Семейный',
  'Приключения',
  'Экшн',
  'Документальный',
  'Природа',
  'Авто',
  'Обзор',
  'Короткометражка',
  'Сказка',
  'Фантастика'
]
