from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0004_personalsettings_audio_display_mode')]
    operations = [migrations.AddField(
        model_name='personalsettings', name='mouse_sets_cue_boundary',
        field=models.BooleanField(default=True),
    )]
