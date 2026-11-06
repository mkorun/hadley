import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'

/**
 * A photo 40 × 20 at `path` as a camera with a GPS receiver leaves it: EXIF with where it was taken, the camera and how
 * it is turned (6: a quarter to the right), with its artist and copyright unless `rights` is false, XMP with the
 * location again and the place by name, its creator and an AI label, and IPTC with the city and a copyright notice.
 * exiftool writes the metadata, as the tests of images.ts do; CI installs it on each system.
 */
export const locatedPhoto = async (
  path: string,
  format: 'jpeg' | 'png' | 'webp',
  orientation = 6,
  rights = true,
): Promise<void> => {
  await sharp({ create: { width: 40, height: 20, channels: 3, background: '#886644' } })
    .toFormat(format)
    .toFile(path)
  const tags = [
    `-EXIF:Orientation#=${orientation}`,
    '-EXIF:GPSLatitude=51.5',
    '-EXIF:GPSLatitudeRef=N',
    '-EXIF:GPSLongitude=7.4',
    '-EXIF:GPSLongitudeRef=E',
    '-EXIF:Model=TestCam',
    '-EXIF:SerialNumber=SN-4711',
    '-XMP-exif:GPSLatitude=51.5 N',
    '-XMP-exif:GPSLongitude=7.4 E',
    '-XMP-dc:Creator=Jane Doe',
    '-XMP-photoshop:City=Dortmund',
    '-XMP-iptcCore:Location=Westfalenpark',
    '-IPTC:City=Dortmund',
    '-IPTC:Sub-location=Westfalenpark',
    '-IPTC:CopyrightNotice=IPTC Jane Doe',
    '-XMP-iptcExt:DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
    ...(rights ? ['-EXIF:Artist=Jane Doe', '-EXIF:Copyright=(c) 2026 Jane Doe'] : []),
  ]
  const exiftool = spawnSync('exiftool', ['-q', '-overwrite_original', ...tags, path], { timeout: 30_000 })
  assert.equal(exiftool.status, 0, String(exiftool.stderr))
}

/**
 * What exiftool reads of a file's location (by position and by name), camera, orientation and rights, `Tag: value`
 * per line; none for a tag it lacks.
 */
export const exifOf = (path: string): string => {
  const tags = ['-s', '-s', '-GPS:all', '-XMP-exif:GPSLatitude', '-Model', '-SerialNumber', '-Orientation', '-n']
  tags.push('-EXIF:Artist', '-EXIF:Copyright', '-IPTC:City', '-IPTC:Sub-location', '-IPTC:CopyrightNotice')
  tags.push('-XMP-photoshop:City', '-XMP-iptcCore:Location')
  const exiftool = spawnSync('exiftool', [...tags, path], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(exiftool.status, 0, exiftool.stderr)
  return exiftool.stdout
}
