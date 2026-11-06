import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'

/**
 * A photo 40 × 20 at `path` as a camera with a GPS receiver leaves it: EXIF with where it was taken, the camera and how
 * it is turned (6: a quarter to the right), and XMP with the location again, its creator and an AI label. exiftool
 * writes the metadata, as the tests of images.ts do; CI installs it on each system.
 */
export const locatedPhoto = async (path: string, format: 'jpeg' | 'png' | 'webp', orientation = 6): Promise<void> => {
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
    '-XMP-iptcExt:DigitalSourceType=http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  ]
  const exiftool = spawnSync('exiftool', ['-q', '-overwrite_original', ...tags, path], { timeout: 30_000 })
  assert.equal(exiftool.status, 0, String(exiftool.stderr))
}

/** What exiftool reads of a file's location, camera and orientation, `Tag: value` per line; none for a tag it lacks. */
export const exifOf = (path: string): string => {
  const tags = ['-s', '-s', '-GPS:all', '-XMP-exif:GPSLatitude', '-Model', '-SerialNumber', '-Orientation', '-n']
  const exiftool = spawnSync('exiftool', [...tags, path], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(exiftool.status, 0, exiftool.stderr)
  return exiftool.stdout
}
