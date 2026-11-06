from django.db import migrations, models


def mark_existing_users(apps, schema_editor):
    # Existing active users should not receive a new-user prompt after upgrading.
    apps.get_model('accounts', 'User').objects.using(schema_editor.connection.alias).filter(
        last_login__isnull=False).update(handbook_seen=True)


class Migration(migrations.Migration):
    dependencies = [('accounts', '0005_personalsettings_mouse_sets_cue_boundary')]

    operations = [
        migrations.AddField(model_name='user', name='handbook_seen', field=models.BooleanField(default=False)),
        migrations.RunPython(mark_existing_users, migrations.RunPython.noop),
    ]
