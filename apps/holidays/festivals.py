"""Shared presentation copy for the admin-controlled Home banner."""
# id: (name, greeting, short explanation, illustration family)
FESTIVAL_INFO = {
    'dashain': ('Dashain', 'Happy Dashain', 'Dashain celebrates the victory of good over evil. Families come together for tika, jamara, blessings, kite flying and traditional swings.', 'dashain-live'),
    'tihar': ('Tihar', 'Happy Tihar', 'Tihar is Nepal’s festival of lights. Diyas, flowers and rangoli brighten homes as families honour animals, welcome prosperity and celebrate the bond between siblings.', 'tihar'),
    'christmas': ('Christmas', 'Merry Christmas', 'Christmas celebrates the birth of Jesus Christ. It is a time for family gatherings, generosity and sharing joy with others.', 'christmas'),
    'new-year': ('New Year', 'Happy New Year', 'New Year marks the beginning of a new calendar year—a time to reflect, celebrate together and welcome fresh beginnings.', 'new-year'),
    'easter': ('Easter', 'Happy Easter', 'Easter celebrates the resurrection of Jesus Christ and carries a message of hope, renewal and new life.', 'easter'),
    'holi': ('Holi', 'Happy Holi', 'Holi is the festival of colours, welcoming spring and celebrating the victory of good over evil through colour, music and togetherness.', 'holi'),
    'nepali-new-year': ('Nepali New Year', 'Happy Nepali New Year', 'Nepali New Year marks the start of the Bikram Sambat calendar in Baisakh. Families and communities celebrate with good wishes and hopes for the year ahead.', 'nepali-new-year'),
    'chhath': ('Chhath', 'Happy Chhath', 'Chhath honours the Sun and Chhathi Maiya. Devotees gather by rivers and ponds to offer prayers at sunset and sunrise, giving thanks for life and well-being.', 'chhath'),
    'buddha-jayanti': ('Buddha Jayanti', 'Peaceful Buddha Jayanti', 'Buddha Jayanti commemorates the birth, enlightenment and passing of Gautama Buddha. It is a time for compassion, reflection and acts of kindness.', 'buddha-jayanti'),
    'shivaratri': ('Maha Shivaratri', 'Warm wishes for Maha Shivaratri', 'Maha Shivaratri honours Lord Shiva. Devotees observe prayers, fasting and night-long vigils as a time for spiritual reflection.', 'shivaratri'),
    'lhosar': ('Lhosar', 'Happy Lhosar', 'Lhosar marks the New Year for several Himalayan communities, each following its own traditions and calendar. Families celebrate through prayers, food, music and good wishes.', 'lhosar'),
    'maghe-sankranti': ('Maghe Sankranti', 'Happy Maghe Sankranti', 'Maghe Sankranti marks the start of Magh and the sun’s transition into Makara. Families share traditional foods such as sesame sweets, chaku and yam.', 'maghe-sankranti'),
    'janai-poornima': ('Janai Purnima', 'Warm wishes for Janai Purnima', 'Janai Purnima is a full-moon festival of renewal and protection. Traditions include changing the sacred thread, tying protective wrist threads and sharing kwati.', 'janai-poornima'),
    'krishna-janmashtami': ('Krishna Janmashtami', 'Happy Krishna Janmashtami', 'Krishna Janmashtami celebrates the birth of Lord Krishna through prayers, devotional songs, fasting and visits to temples.', 'krishna-janmashtami'),
    'eid': ('Eid', 'Eid Mubarak', 'Eid is a time of prayer, charity and shared meals. Families and communities come together in gratitude, generosity and celebration.', 'eid'),
    'celebration': ('Special celebration', 'Wishing you a joyful celebration', 'A moment to come together, share good wishes and celebrate the people and traditions that connect us.', 'celebration'),
}
THEME_CHOICES = [('auto', 'Automatic · follow festival dates'), ('off', 'Off · hide festival banner')] + [(key, value[0]) for key, value in FESTIVAL_INFO.items()]

FESTIVAL_MOTION = {
    'dashain': 'kites', 'tihar': 'lights', 'christmas': 'snow',
    'new-year': 'fireworks', 'easter': 'butterflies', 'holi': 'colour',
    'nepali-new-year': 'flags', 'chhath': 'sun', 'buddha-jayanti': 'petals',
    'shivaratri': 'bell', 'lhosar': 'flags', 'maghe-sankranti': 'sun',
    'janai-poornima': 'water', 'krishna-janmashtami': 'feather',
    'eid': 'lantern', 'celebration': 'confetti',
}
