"""
The hub's small pleasures: a thought for the day and a little laugh.

Both are picked by the date, so everyone sees the same one on the same day
and it changes at midnight — something to glance at on the way in, never
something to scroll. Nothing is fetched: the lists live here, so they cost
nothing, work offline, and every line has been read by a person before it
is shown to one. Work-friendly throughout: these appear on a screen that
gets held up in a kitchen or across a counter.
"""

from datetime import date

QUOTES = [
    ("The secret of getting ahead is getting started.", "Mark Twain"),
    ("It always seems impossible until it's done.", "Nelson Mandela"),
    ("Well done is better than well said.", "Benjamin Franklin"),
    ("Quality is not an act, it is a habit.", "Aristotle"),
    ("The best way out is always through.", "Robert Frost"),
    ("Start where you are. Use what you have. Do what you can.", "Arthur Ashe"),
    ("Whether you think you can or you think you can't, you're right.", "Henry Ford"),
    ("Do the hard jobs first. The easy jobs will take care of themselves.", "Dale Carnegie"),
    ("Little by little, one travels far.", "J. R. R. Tolkien"),
    ("Opportunity is missed by most people because it is dressed in overalls and looks like work.", "Thomas Edison"),
    ("The only way to do great work is to love what you do.", "Steve Jobs"),
    ("A year from now you may wish you had started today.", "Karen Lamb"),
    ("Don't count the days. Make the days count.", "Muhammad Ali"),
    ("What you do today can improve all your tomorrows.", "Ralph Marston"),
    ("Success is the sum of small efforts, repeated day in and day out.", "Robert Collier"),
    ("Either you run the day or the day runs you.", "Jim Rohn"),
    ("Pleasure in the job puts perfection in the work.", "Aristotle"),
    ("It does not matter how slowly you go as long as you do not stop.", "Confucius"),
    ("The harder I work, the luckier I get.", "Samuel Goldwyn"),
    ("Nothing will work unless you do.", "Maya Angelou"),
    ("Believe you can and you're halfway there.", "Theodore Roosevelt"),
    ("Be so good they can't ignore you.", "Steve Martin"),
    ("Every accomplishment starts with the decision to try.", "John F. Kennedy"),
    ("If you want to lift yourself up, lift up someone else.", "Booker T. Washington"),
    ("Act as if what you do makes a difference. It does.", "William James"),
    ("Perseverance is not a long race; it is many short races one after the other.", "Walter Elliot"),
    ("Keep your face always toward the sunshine, and shadows will fall behind you.", "Walt Whitman"),
    ("Your work is going to fill a large part of your life — make it work you're proud of.", "Steve Jobs"),
    ("Small deeds done are better than great deeds planned.", "Peter Marshall"),
    ("A smooth sea never made a skilled sailor.", "Franklin D. Roosevelt"),
    ("You don't have to be great to start, but you have to start to be great.", "Zig Ziglar"),
    ("Work hard in silence; let your success be your noise.", "Frank Ocean"),
    ("Happiness is not something ready made. It comes from your own actions.", "Dalai Lama"),
    ("Look up at the stars and not down at your feet.", "Stephen Hawking"),
    ("Don't watch the clock; do what it does. Keep going.", "Sam Levenson"),
    ("Setting goals is the first step in turning the invisible into the visible.", "Tony Robbins"),
    ("Do what you can, with what you have, where you are.", "Theodore Roosevelt"),
    ("Kind words can be short and easy to speak, but their echoes are truly endless.", "Mother Teresa"),
    ("The way to get started is to quit talking and begin doing.", "Walt Disney"),
    ("Courage is not the absence of fear, but the triumph over it.", "Nelson Mandela"),
    ("In the middle of difficulty lies opportunity.", "Albert Einstein"),
    ("If you're going through hell, keep going.", "Winston Churchill"),
    ("Alone we can do so little; together we can do so much.", "Helen Keller"),
    ("Rest when you're weary. Refresh and renew yourself. Then get back to work.", "Ralph Marston"),
    ("Great things are done by a series of small things brought together.", "Vincent van Gogh"),
]

JOKES = [
    ("I told my boss three companies were after me.", "He asked which ones. I said the gas, the water and the electricity."),
    ("Why did the coffee file a police report?", "It got mugged."),
    ("My boss said, \"Dress for the job you want.\"", "Now I'm in a meeting in my pyjamas."),
    ("Why don't eggs tell jokes at work?", "They'd crack each other up."),
    ("I asked the butcher if he had a sense of humour.", "He said, \"Yes, but it's a bit offal.\""),
    ("Why did the scarecrow get promoted?", "He was outstanding in his field."),
    ("I got a job at a bakery.", "I kneaded the dough."),
    ("What did the coffee say to the tea on Monday morning?", "\"Brew got this.\""),
    ("Why did the tomato blush?", "It saw the salad dressing."),
    ("My manager told me to have a good day.", "So I went home."),
    ("What's a sausage's favourite exercise?", "The sausage roll."),
    ("I'm on a seafood diet.", "I see food, and I eat it."),
    ("Why did the clock get told off at work?", "It kept tocking back."),
    ("What do you call cheese that isn't yours?", "Nacho cheese."),
    ("I used to work in a shoe recycling shop.", "It was sole destroying."),
    ("Why did the barista break up with the espresso?", "It was too intense."),
    ("What did the lettuce say to the celery?", "\"Quit stalking me.\""),
    ("My job is to stand around and do nothing.", "I'm a full-time mannequin. It's a stationary position."),
    ("Why did the chicken join a band?", "It had the drumsticks."),
    ("I asked for a raise and my boss said, \"Sure, go and stand on that chair.\"", "Turns out he meant it literally."),
    ("What did the grape do when it got stepped on?", "It let out a little wine."),
    ("Why was the broom late for work?", "It overswept."),
    ("I quit my job at the orange juice factory.", "I couldn't concentrate."),
    ("What did the steak say at the staff meeting?", "\"Let's get to the meat of it.\""),
    ("Why did the cafe close on Mondays?", "The owner didn't have the beans for it."),
    ("What do you call a can opener that doesn't work?", "A can't opener."),
    ("My colleague said I was in denial about being late.", "I said, \"I'll deal with that tomorrow.\""),
    ("Why did the bread get the job?", "It rose to the occasion."),
    ("I got hired at the calendar factory, then fired.", "All I did was take a couple of days off."),
    ("Why did the mushroom get invited to every staff do?", "He was a fun guy."),
    ("What's the best thing about Switzerland at work?", "Not sure, but the flag is a big plus."),
    ("How does a butcher introduce his wife?", "\"Meat Patty.\""),
    ("Why did the lamb roast cross the road?", "To get to the other side dish."),
    ("My boss asked why I only get sick on weekdays.", "I said it must be my weekend immune system."),
    ("What do you call a fake noodle?", "An impasta."),
    ("Why was the maths book always at work early?", "It had a lot of problems to sort out."),
    ("I tried to make a belt out of watches.", "It was a waist of time."),
    ("Why did the coffee taste like mud?", "It was ground this morning."),
    ("What did the pen say at clock-out?", "\"Write, I'm done.\""),
    ("Why did the pie go to the dentist?", "It needed a filling."),
    ("What did the pig say on a hot shift?", "\"I'm bacon in here.\""),
    ("Why don't scientists trust atoms at work?", "They make up everything."),
    ("What do you call a sleeping bull in the cool room?", "A bulldozer."),
    ("Why did the cashier quit?", "She'd had enough of checking out."),
    ("I asked the waiter if the fish was fresh.", "He said, \"Fresh? It's still checking its emails.\""),
]


def daily(today: date | None = None) -> dict:
    """
    Today's thought and today's laugh, as the site's template and the app's
    JSON both read them. Picked by the day's number so the two lists turn
    over at different rates and a pair never repeats for years.
    """
    day = (today or date.today()).toordinal()
    text, who = QUOTES[day % len(QUOTES)]
    setup, punchline = JOKES[(day * 7) % len(JOKES)]
    return {
        "quote": {"text": text, "who": who},
        "joke": {"setup": setup, "punchline": punchline},
    }
