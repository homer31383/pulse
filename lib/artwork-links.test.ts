// Run: npx tsx --test lib/artwork-links.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artworkLinksEnabled, imageSearchUrl, parseArtworkHeading } from './artwork-links'

// ── Real stored headings, one per pattern ──────────────────────────────────

test('pattern A: Artist, *Title*, year (Arnolfini, 92dd59b3)', () => {
  assert.deepEqual(parseArtworkHeading('# Jan van Eyck, *The Arnolfini Portrait*, 1434'),
    { title: 'The Arnolfini Portrait', artist: 'Jan van Eyck' })
})

test('pattern A with circa and a date range (Rubens, 69d6bbde): alias parenthetical ignored', () => {
  assert.deepEqual(
    parseArtworkHeading('# Peter Paul Rubens, *Venus and Cupid* (also known as *The Toilet of Venus*), c. 1610–1611'),
    { title: 'Venus and Cupid', artist: 'Peter Paul Rubens' },
  )
})

test('pattern A with "begun" year (Rembrandt, 68d62a77)', () => {
  assert.deepEqual(parseArtworkHeading('# Rembrandt van Rijn, *Let the Little Children Come Unto Me*, begun 1627'),
    { title: 'Let the Little Children Come Unto Me', artist: 'Rembrandt van Rijn' })
})

test('pattern A, series in a second italic span (Rauschenberg, 8323f072)', () => {
  assert.deepEqual(parseArtworkHeading('# Robert Rauschenberg, *Sky Garden* (from *Stoned Moon*), 1969'),
    { title: 'Sky Garden', artist: 'Robert Rauschenberg' })
})

test('pattern A, single-name artists (Correggio 81736132, El Greco ad4f2421)', () => {
  assert.deepEqual(parseArtworkHeading('# Correggio, *Madonna of Saint Sebastian*, c. 1525–27'),
    { title: 'Madonna of Saint Sebastian', artist: 'Correggio' })
  assert.deepEqual(parseArtworkHeading('# El Greco, *The Martyrdom of Saint Maurice and the Theban Legion*, 1580–82'),
    { title: 'The Martyrdom of Saint Maurice and the Theban Legion', artist: 'El Greco' })
})

test('pattern A, parenthetical inside the title (Lippi, ff2457ab)', () => {
  assert.deepEqual(parseArtworkHeading('# Fra Filippo Lippi, *Adoration in the Forest (Mystical Nativity)*, c. 1459'),
    { title: 'Adoration in the Forest (Mystical Nativity)', artist: 'Fra Filippo Lippi' })
})

test('pattern A, accented artist and long title (Villalpando, 6cb876d5)', () => {
  assert.deepEqual(
    parseArtworkHeading('# Cristóbal de Villalpando, *Moses and the Brazen Serpent and the Transfiguration of Jesus*, 1683'),
    { title: 'Moses and the Brazen Serpent and the Transfiguration of Jesus', artist: 'Cristóbal de Villalpando' },
  )
})

test('pattern B: Artist, *Title* (year) (Hepworth, 65a54fe6)', () => {
  assert.deepEqual(parseArtworkHeading('# Barbara Hepworth, *Sculpture with Colour (Oval Form) Pale Blue and Red* (1943)'),
    { title: 'Sculpture with Colour (Oval Form) Pale Blue and Red', artist: 'Barbara Hepworth' })
  assert.deepEqual(parseArtworkHeading('# Rembrandt van Rijn, *Let the Little Children Come Unto Me* (begun c. 1627)'),
    { title: 'Let the Little Children Come Unto Me', artist: 'Rembrandt van Rijn' })
})

test('heading text without the # marks parses the same', () => {
  assert.deepEqual(parseArtworkHeading('Willem de Kooning, *Woman-Ochre*, 1954–55'),
    { title: 'Woman-Ochre', artist: 'Willem de Kooning' })
})

// ── Real stored headings that must get no link ─────────────────────────────

test('unitalicised title is not guessed (Villalpando sacristy, 4c4ef8d9)', () => {
  assert.equal(parseArtworkHeading(
    '# Cristóbal de Villalpando, Sacristy Paintings, Mexico City Metropolitan Cathedral, c. 1683–86'), null)
})

test('the "Today\'s Masterwork" date headings are not artworks', () => {
  assert.equal(parseArtworkHeading("# 🎨 Today's Masterwork — Friday, July 24, 2026"), null)
  assert.equal(parseArtworkHeading("# Today's Masterwork"), null)
  assert.equal(parseArtworkHeading("# Today's Masterwork — Wednesday, September 9, 2026"), null)
})

test('section headings and bold metadata lines are not artworks', () => {
  assert.equal(parseArtworkHeading('## Key Takeaways'), null)
  assert.equal(parseArtworkHeading('**Oil on oak panel · 82.2 × 60 cm · Early Netherlandish / Northern Renaissance**'), null)
})

// ── Edge cases ─────────────────────────────────────────────────────────────

test('leading emoji is dropped', () => {
  assert.deepEqual(parseArtworkHeading('# 🎨 Johannes Vermeer, *Girl with a Pearl Earring*, c. 1665'),
    { title: 'Girl with a Pearl Earring', artist: 'Johannes Vermeer' })
})

test('multiple artists joined by "and" stay together', () => {
  assert.deepEqual(parseArtworkHeading('# Peter Paul Rubens and Jan Brueghel the Elder, *The Sense of Sight*, 1617'),
    { title: 'The Sense of Sight', artist: 'Peter Paul Rubens and Jan Brueghel the Elder' })
})

test('multiple artists separated by commas are not guessed', () => {
  assert.equal(parseArtworkHeading('# Rubens, Brueghel, *The Sense of Sight*, 1617'), null)
})

test('unknown or anonymous artist gets no link', () => {
  assert.equal(parseArtworkHeading('# Unknown artist, *The Unicorn in Captivity*, c. 1495–1505'), null)
  assert.equal(parseArtworkHeading('# Anonymous, *The Wilton Diptych*, c. 1395'), null)
})

test('no artist at all gets no link', () => {
  assert.equal(parseArtworkHeading('# *The Unicorn in Captivity*, c. 1495–1505'), null)
})

test('a year in the artist slot is not a name', () => {
  assert.equal(parseArtworkHeading('# 1434, *The Arnolfini Portrait*'), null)
  assert.equal(parseArtworkHeading('# Master of 1499, *Diptych*'), null)
})

test('a year inside the title is kept', () => {
  assert.deepEqual(parseArtworkHeading('# Pablo Picasso, *Les Demoiselles d\'Avignon (1907)*'),
    { title: 'Les Demoiselles d\'Avignon (1907)', artist: 'Pablo Picasso' })
})

test('quotes inside italics are stripped from the ends, kept inside', () => {
  assert.deepEqual(parseArtworkHeading('# Edvard Munch, *"The Scream"*, 1893'),
    { title: 'The Scream', artist: 'Edvard Munch' })
  assert.deepEqual(parseArtworkHeading('# Thomas Gainsborough, *The "Blue" Boy*, c. 1770'),
    { title: 'The "Blue" Boy', artist: 'Thomas Gainsborough' })
})

test('a quoted title without italics parses (straight and curly quotes)', () => {
  assert.deepEqual(parseArtworkHeading('# Edvard Munch, "The Scream", 1893'),
    { title: 'The Scream', artist: 'Edvard Munch' })
  assert.deepEqual(parseArtworkHeading('# Edvard Munch, “The Scream”, 1893'),
    { title: 'The Scream', artist: 'Edvard Munch' })
})

test('underscore italics parse', () => {
  assert.deepEqual(parseArtworkHeading('# Jan van Eyck, _The Arnolfini Portrait_, 1434'),
    { title: 'The Arnolfini Portrait', artist: 'Jan van Eyck' })
})

test('bold title is not treated as italics', () => {
  assert.equal(parseArtworkHeading('# Jan van Eyck, **The Arnolfini Portrait**, 1434'), null)
})

test('prose after the title is not guessed', () => {
  assert.equal(parseArtworkHeading('# Why Jan van Eyck, *The Arnolfini Portrait* still matters'), null)
})

test('sentence-like text in the artist slot is rejected', () => {
  assert.equal(parseArtworkHeading('# The one painting every visitor to London should make time to see this autumn, *The Arnolfini Portrait*'), null)
})

test('very long titles: long real-world titles parse, a runaway span does not', () => {
  const long = 'The Virgin and Child with Saint Anne, Saint John the Baptist, and Angels in a Landscape with a Distant View of a City and Mountains'
  assert.deepEqual(parseArtworkHeading(`# Leonardo da Vinci, *${long}*, c. 1503`), { title: long, artist: 'Leonardo da Vinci' })
  assert.equal(parseArtworkHeading(`# Leonardo da Vinci, *${'word '.repeat(60)}*, c. 1503`), null)
})

// ── URL and channel config ─────────────────────────────────────────────────

test('search URL encodes title then artist', () => {
  assert.equal(
    imageSearchUrl({ title: 'Venus and Cupid', artist: 'Peter Paul Rubens' }),
    'https://www.google.com/search?tbm=isch&q=Venus%20and%20Cupid%20Peter%20Paul%20Rubens',
  )
  assert.equal(
    imageSearchUrl({ title: 'Woman-Ochre', artist: 'Willem de Kooning' }),
    'https://www.google.com/search?tbm=isch&q=Woman-Ochre%20Willem%20de%20Kooning',
  )
  assert.match(imageSearchUrl({ title: 'Les Demoiselles d\'Avignon & co', artist: 'Cristóbal' }), /%26%20co%20Crist%C3%B3bal$/)
})

test('channel config matches Classic Art by name, case-insensitively, and nothing else', () => {
  assert.equal(artworkLinksEnabled({ name: 'Classic Art' }), true)
  assert.equal(artworkLinksEnabled({ name: ' classic art ' }), true)
  assert.equal(artworkLinksEnabled({ id: 'c29d75c7-6612-4ef8-883e-07b57c822965', name: 'Art and design' }), false)
  assert.equal(artworkLinksEnabled({ name: 'Classic Movies' }), false)
  assert.equal(artworkLinksEnabled({ name: null }), false)
  assert.equal(artworkLinksEnabled({}), false)
})
