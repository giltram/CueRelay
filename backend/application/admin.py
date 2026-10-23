"""Admin is composed here so accounts never imports organizations."""
from django import forms
from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.http import HttpResponseRedirect
from accounts.models import User
from organizations.models import Organization, OrganizationMembership
from organizations.services import create_organization, rename_organization
from .identity_admin import save_account


class DevOnlyAdmin:
    def has_module_permission(self, request):
        return request.user.is_active and request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return self.has_module_permission(request)

    def has_change_permission(self, request, obj=None):
        return self.has_module_permission(request)

    def has_add_permission(self, request):
        return self.has_module_permission(request)

    def has_delete_permission(self, request, obj=None):
        return False

    def changeform_view(self, request, object_id=None, form_url='', extra_context=None):
        try:
            return super().changeform_view(request, object_id, form_url, extra_context)
        except ValidationError as error:
            # Raised inside Admin's atomic save: the entire write rolls back.
            self.message_user(request, '；'.join(error.messages), level=messages.ERROR)
            return HttpResponseRedirect(request.path)


@admin.register(User)
class AccountAdmin(DevOnlyAdmin, UserAdmin):
    fieldsets = UserAdmin.fieldsets + (('显示资料', {'fields': ('display_name',)}),)
    add_fieldsets = UserAdmin.add_fieldsets + (('显示资料', {'fields': ('display_name',)}),)
    actions = None

    def save_model(self, request, obj, form, change):
        save_account(obj)


class OrganizationForm(forms.ModelForm):
    initial_organizer = forms.ModelChoiceField(queryset=User.objects.filter(is_active=True), required=True, label='初始 organizer')

    class Meta:
        model = Organization
        fields = ['name']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            del self.fields['initial_organizer']


@admin.register(Organization)
class OrganizationAdmin(DevOnlyAdmin, admin.ModelAdmin):
    form = OrganizationForm
    list_display = ('name', 'created_at')
    actions = None

    def save_model(self, request, obj, form, change):
        if change:
            rename_organization(request.user, obj.pk, obj.name)
        else:
            created = create_organization(obj.name, form.cleaned_data['initial_organizer'].pk)
            obj.pk = created.pk
            obj.created_at = created.created_at
            obj._state.adding = False


@admin.register(OrganizationMembership)
class MembershipAdmin(DevOnlyAdmin, admin.ModelAdmin):
    list_display = ('organization', 'user', 'role', 'joined_at')
    readonly_fields = ('organization', 'user', 'role', 'joined_at')
    actions = None

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


admin.site.unregister(Group)
