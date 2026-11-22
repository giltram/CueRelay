"""Separate compatibility/media/production suites; never expands unified Chromium discovery."""
import hashlib
import subprocess

from django.test import override_settings

from .regression_fixture import RegressionFixture
from projects.services import create_project


@override_settings(DEBUG=True)
class PlatformRegressionTests(RegressionFixture):
    def run_browser(self, scenario):
        raise RuntimeError('Standalone suites require the process adapter in scripts/run_isolated_regression.py')


    def test_platform(self):
        self.run_browser('platform account handbook editing save and media capability')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 2)
        self.assertEqual(self.project.document['cues'][0]['text'], '跨浏览器真实保存')

    def test_specialists(self):
        self.run_browser('media existing file handle timeline and rendered PCM specialists')

    def test_production(self):
        self.run_browser('production handbook licenses and source archive downloads')
        self.project.refresh_from_db()
        self.assertEqual(self.project.revision, 1)

    def test_media(self):
        video = self.video.parent / 'synthetic-180s-5.1.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                        'color=c=black:s=320x180:r=10:d=180', '-f', 'lavfi', '-i',
                        'aevalsrc=0.1*sin(2*PI*440*t)|0.1*sin(2*PI*550*t)|0.1*sin(2*PI*660*t)|0.1*sin(2*PI*80*t)|0.1*sin(2*PI*770*t)|0.1*sin(2*PI*880*t):s=48000:d=180:c=5.1',
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
                        '-b:a', '384k', '-movflags', '+faststart', str(video)], check=True, timeout=60)
        self.assertLess(video.stat().st_size, 16 * 1024 * 1024)
        import json
        specification = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
            'format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels,channel_layout',
            '-of', 'json', str(video)], text=True))
        audio = next(stream for stream in specification['streams'] if stream['codec_type'] == 'audio')
        self.assertEqual((audio['channels'], audio['sample_rate']), (6, '48000'))
        self.fixtures['mediaSpecification'] = specification
        source = self.project.document['source'].split('Dialogue:', 1)[0] + 'Dialogue: 0,0:02:30.00,0:02:35.00,Default,,0000,0000,0000,,远端预览合成字幕\n'
        project = create_project(self.organizer, self.project.organization_id, name='长多声道合成媒体',
                                 description='', source=source, media={
                                     'sha256': hashlib.sha256(video.read_bytes()).hexdigest(),
                                     'size': video.stat().st_size, 'duration_ms': 180000})
        self.fixtures.update(video=str(video),
                             projectPath=f'/api/organizations/{project.organization_id}/projects/{project.pk}',
                             workspacePath=f'/organizations/{project.organization_id}/projects/{project.pk}/workspace')
        self.run_browser('media bounded 180 second six channel seek preview audition and cleanup')
        project.refresh_from_db()
        self.assertEqual(project.revision, 1)
        self.assertEqual(project.document['cues'][0]['text'], '远端预览合成字幕')
